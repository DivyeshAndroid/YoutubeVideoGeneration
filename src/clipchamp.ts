import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { defaultChromePath } from "./platform.js";

export type ClipchampVoiceRequest = {
  text: string;
  destinationPath: string;
  language?: string;
  voiceName?: string;
};

export type ClipchampVoiceServiceOptions = {
  executablePath?: string;
  userDataDir?: string;
  headless?: boolean;
  timeoutMs?: number;
};

const defaultChrome = defaultChromePath();

/** Automates Clipchamp text-to-speech through a reusable, persistent Chrome session. */
export class ClipchampVoiceService {
  private context?: BrowserContext;
  private page?: Page;
  private readonly executablePath?: string;
  private readonly userDataDir: string;
  private readonly headless: boolean;
  private readonly timeoutMs: number;

  constructor(options: ClipchampVoiceServiceOptions = {}) {
    this.executablePath = options.executablePath ?? defaultChrome;
    this.userDataDir = path.resolve(options.userDataDir ?? "work/clipchamp-profile");
    this.headless = options.headless ?? false;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async start(): Promise<void> {
    if (this.context) return;
    await fs.mkdir(this.userDataDir, { recursive: true });
    this.context = await chromium.launchPersistentContext(this.userDataDir, {
      executablePath: this.executablePath,
      headless: this.headless,
      acceptDownloads: true,
      viewport: { width: 1440, height: 1000 }
    });
    this.page = this.context.pages()[0] ?? await this.context.newPage();
    this.page.setDefaultTimeout(this.timeoutMs);
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = undefined;
    this.page = undefined;
  }

  async synthesize(request: ClipchampVoiceRequest): Promise<string> {
    if (!request.text.trim()) throw new Error("Clipchamp narration text cannot be empty");
    await this.start();
    const page = this.page!;
    const destination = path.resolve(request.destinationPath);
    await fs.mkdir(path.dirname(destination), { recursive: true });

    await page.goto("https://app.clipchamp.com/editor", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const text = document.body?.innerText ?? "";
      return location.pathname.includes("/consumer/home")
        || /record\s*&\s*create/i.test(text)
        || /your media/i.test(text);
    }, undefined, { timeout: this.timeoutMs });
    await this.assertSignedIn(page);
    await this.openTextToSpeech(page);
    await this.assertSignedIn(page);
    if (request.language) await this.selectOption(page, /language/i, request.language);
    if (request.voiceName) await this.selectOption(page, /voice/i, request.voiceName);
    await this.enforceNormalSpeed(page);

    const namedTextBox = page.getByRole("textbox", { name: /text|script|speech/i });
    const placeholderTextBox = page.getByPlaceholder(/type|text|script|speech/i);
    const genericTextBox = page.locator('textarea:visible, [contenteditable="true"]:visible');
    const textBox = namedTextBox.or(placeholderTextBox).or(genericTextBox).last();
    try {
      await textBox.waitFor({ state: "visible" });
    } catch (error) {
      const diagnosticsDir = path.resolve("work/clipchamp-diagnostics");
      await fs.mkdir(diagnosticsDir, { recursive: true });
      await Promise.all([
        page.screenshot({ path: path.join(diagnosticsDir, "editor.png"), fullPage: true }).catch(() => undefined),
        page.content().then((html) => fs.writeFile(path.join(diagnosticsDir, "editor.html"), html)).catch(() => undefined),
        fs.writeFile(path.join(diagnosticsDir, "frames.txt"), page.frames().map((frame) => `${frame.name()}\t${frame.url()}`).join("\n"))
      ]);
      throw error;
    }
    await textBox.fill(request.text);

    // Clipchamp versions either return an audio response or initiate a browser download.
    const audioResponse = page.waitForResponse(async (candidate) => {
      if (!candidate.ok()) return false;
      const contentType = (await candidate.headerValue("content-type")) ?? "";
      return /^audio\//i.test(contentType)
        || (/audio|speech|tts/i.test(candidate.url()) && /octet-stream/i.test(contentType));
    }, { timeout: this.timeoutMs }).then((response) => ({ kind: "response" as const, response }));
    const browserDownload = page.waitForEvent("download", { timeout: this.timeoutMs })
      .then((download) => ({ kind: "download" as const, download }));

    await page.getByRole("button", { name: /save to media|generate|preview|listen/i }).last().click();
    const result = await Promise.race([audioResponse, browserDownload]);
    if (result.kind === "response") await fs.writeFile(destination, await result.response.body());
    else await result.download.saveAs(destination);

    const stat = await fs.stat(destination);
    if (stat.size < 1024) throw new Error(`Clipchamp produced an unexpectedly small audio file: ${destination}`);
    return destination;
  }

  private async openTextToSpeech(page: Page): Promise<void> {
    if (/\/home(?:[/?#]|$)/i.test(page.url())) {
      const textToSpeechCard = page.getByText(/^text\s*to\s*speech$/i).first();
      const headingId = await textToSpeechCard.getAttribute("id");
      const quickStart = headingId
        ? page.locator(`button[aria-describedby="${headingId}"]`).first()
        : textToSpeechCard.locator("xpath=../following-sibling::button").first();
      if (await quickStart.isVisible().catch(() => false)) {
        await quickStart.click();
        await page.waitForURL(/\/editor(?:[/?#]|$)/i);
        return;
      }
    }

    const create = page.getByRole("button", { name: /create (a )?new video/i }).or(
      page.getByRole("link", { name: /create (a )?new video/i })
    ).or(
      page.getByText(/^create (a )?new video$/i)
    ).first();
    if (await create.isVisible().catch(() => false)) {
      await create.click();
      await page.waitForURL(/\/editor(?:[/?#]|$)/i);
    }

    const recordAndCreate = page.getByText(/record\s*&\s*create/i).first();
    if (await recordAndCreate.isVisible().catch(() => false)) await recordAndCreate.click();

    const textToSpeech = page.getByText(/text\s*to\s*speech/i).first();
    await textToSpeech.waitFor({ state: "visible" });
    await textToSpeech.click();
  }

  private async assertSignedIn(page: Page): Promise<void> {
    const signIn = page.getByRole("button", { name: /sign in|log in/i }).or(
      page.getByRole("link", { name: /sign in|log in/i })
    ).first();
    if (await signIn.isVisible().catch(() => false)) {
      throw new Error("Clipchamp sign-in is required. Keep CLIPCHAMP_HEADLESS=false, sign in in the opened Chrome window, then retry.");
    }
  }

  private async selectOption(page: Page, label: RegExp, value: string): Promise<void> {
    const select = page.getByLabel(label).or(page.getByRole("combobox", { name: label })).first();
    await select.waitFor({ state: "visible" });
    if (await select.evaluate((element) => element.tagName.toLowerCase()) === "select") {
      await select.selectOption({ label: value });
      return;
    }
    await select.click();
    const option = page.getByRole("option", { name: value, exact: true }).or(
      page.getByText(value, { exact: true })
    ).last();
    await option.waitFor({ state: "visible" });
    await option.click();
  }

  private async enforceNormalSpeed(page: Page): Promise<void> {
    const speedControl = page.getByLabel(/speed|pace/i).or(
      page.getByRole("combobox", { name: /speed|pace/i })
    ).first();
    if (!await speedControl.isVisible().catch(() => false)) return;

    const tagName = await speedControl.evaluate((element) => element.tagName.toLowerCase());
    const type = await speedControl.getAttribute("type");
    if (tagName === "input" && type === "range") {
      await speedControl.evaluate((element) => {
        const input = element as HTMLInputElement;
        input.value = "1";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      return;
    }
    if (tagName === "select") {
      const values = await speedControl.locator("option").allTextContents();
      const normal = values.find((value) => /^(1(?:\.0)?x|normal|medium|regular)$/i.test(value.trim()));
      if (normal) await speedControl.selectOption({ label: normal });
      return;
    }

    await speedControl.click();
    const normalOption = page.getByRole("option", { name: /^(1(?:\.0)?x|normal|medium|regular)$/i }).last();
    if (await normalOption.isVisible().catch(() => false)) await normalOption.click();
    else await page.keyboard.press("Escape");
  }
}

export async function downloadClipchampVoice(
  request: ClipchampVoiceRequest,
  options?: ClipchampVoiceServiceOptions
): Promise<string> {
  const service = new ClipchampVoiceService(options);
  try {
    return await service.synthesize(request);
  } finally {
    await service.close();
  }
}
