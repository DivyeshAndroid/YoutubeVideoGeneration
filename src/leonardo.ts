import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { chromium, type BrowserContext, type Page } from "playwright-core";

export type LeonardoImageRequest = {
  prompt: string;
  destinationPath: string;
};

export type LeonardoImageServiceOptions = {
  executablePath?: string;
  userDataDir?: string;
  headless?: boolean;
  timeoutMs?: number;
  authenticationTimeoutMs?: number;
  generatorUrl?: string;
  maxAttempts?: number;
};

const defaultChrome = process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : undefined;
const defaultGeneratorUrl = "https://app.leonardo.ai/generate?model=auto-preset&aspectRatio=1%3A1&style=a5632c7c-ddbb-4e2f-ba34-8456ab3ac436&mode=fast&quantity=1&seedEnabled=false&negativePromptEnabled=false";

type GenerationFailureKind = "moderation" | "credits" | "rate-limit" | "authentication" | "generation";

class LeonardoGenerationError extends Error {
  constructor(message: string, readonly kind: GenerationFailureKind, readonly retryable = true) {
    super(message);
    this.name = "LeonardoGenerationError";
  }
}

/** Generates images through Leonardo's web application using a persistent login. */
export class LeonardoImageService {
  private context?: BrowserContext;
  private page?: Page;
  private readonly executablePath?: string;
  private readonly userDataDir: string;
  private readonly headless: boolean;
  private readonly timeoutMs: number;
  private readonly authenticationTimeoutMs: number;
  private readonly generatorUrl: string;
  private readonly maxAttempts: number;

  constructor(options: LeonardoImageServiceOptions = {}) {
    this.executablePath = options.executablePath ?? defaultChrome;
    this.userDataDir = path.resolve(options.userDataDir ?? "work/leonardo-profile");
    this.headless = options.headless ?? true;
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.authenticationTimeoutMs = options.authenticationTimeoutMs ?? 600_000;
    this.generatorUrl = options.generatorUrl ?? defaultGeneratorUrl;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  async start(): Promise<void> {
    if (this.context) return;
    await this.launch(this.headless);
    await this.openGenerator();
    if (await this.isAuthenticationRequired()) await this.refreshAuthentication();
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = undefined;
    this.page = undefined;
  }

  async generate(request: LeonardoImageRequest): Promise<string> {
    if (!request.prompt.trim()) throw new Error("Leonardo image prompt cannot be empty");
    await this.start();
    const destination = path.resolve(request.destinationPath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    let prompt = request.prompt.trim();
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        if (attempt > 1) await this.openGenerator();
        const image = await this.generateAttempt(prompt);
        await this.writeImage(image, destination);
        return destination;
      } catch (error) {
        lastError = error;
        await this.saveDiagnostics(attempt, prompt, error);
        const classified = this.classifyError(error);
        if (!classified.retryable || attempt === this.maxAttempts) throw classified;
        const revised = this.revisePrompt(prompt, classified.kind, attempt);
        console.warn(`Leonardo ${classified.kind} error on attempt ${attempt}/${this.maxAttempts}; retrying with a safer prompt.`);
        prompt = revised;
      }
    }
    throw lastError;
  }

  private async generateAttempt(prompt: string): Promise<Buffer> {
    const page = this.page!;
    if (await this.isAuthenticationRequired()) throw new LeonardoGenerationError("Leonardo authentication is required", "authentication", false);
    const promptBox = page.getByRole("textbox", { name: /prompt/i }).or(
      page.getByPlaceholder(/prompt|describe|imagine/i)
    ).or(page.locator("textarea:visible")).last();
    await promptBox.waitFor({ state: "visible" });
    await promptBox.fill(prompt);

    const imageResult = page.waitForResponse(async (response) => {
      if (!response.ok()) return false;
      const url = new URL(response.url());
      const contentType = (await response.headerValue("content-type")) ?? "";
      const contentLength = Number((await response.headerValue("content-length")) ?? 0);
      return /(^|\.)assets\.leonardo\.ai$/i.test(url.hostname)
        && /^image\/(png|jpe?g|webp)/i.test(contentType)
        && (contentLength === 0 || contentLength > 50_000);
    }, { timeout: this.timeoutMs }).then(async (response) => ({ kind: "image" as const, image: Buffer.from(await response.body()) }));
    const visibleError = page.locator('[role="alert"]:visible, [data-sonner-toast]:visible, [class*="toast"]:visible')
      .filter({ hasText: /moderation|content policy|not allowed|unsafe|failed|error|something went wrong|try again|token|credit|upgrade|rate limit|too many/i })
      .last()
      .waitFor({ state: "visible", timeout: this.timeoutMs })
      .then(async () => ({ kind: "error" as const, message: await page.locator('[role="alert"]:visible, [data-sonner-toast]:visible, [class*="toast"]:visible').last().innerText() }));

    await page.getByRole("button", { name: /^generate(?: image)?$/i }).last().click();
    const result = await Promise.race([imageResult, visibleError]);
    if (result.kind === "error") throw new Error(result.message);
    if (result.image.length < 10_000) throw new Error("Leonardo returned an unexpectedly small image");
    return result.image;
  }

  private async launch(headless: boolean): Promise<void> {
    await fs.mkdir(this.userDataDir, { recursive: true });
    this.context = await chromium.launchPersistentContext(this.userDataDir, {
      executablePath: this.executablePath,
      headless,
      acceptDownloads: true,
      viewport: { width: 1440, height: 1000 }
    });
    this.page = this.context.pages()[0] ?? await this.context.newPage();
    this.page.setDefaultTimeout(this.timeoutMs);
  }

  private async openGenerator(): Promise<void> {
    await this.page!.goto(this.generatorUrl, { waitUntil: "domcontentloaded" });
    await Promise.race([
      this.page!.getByRole("textbox", { name: /prompt/i }).or(this.page!.getByPlaceholder(/prompt|describe|imagine/i)).first().waitFor({ state: "visible" }),
      this.page!.getByRole("button", { name: /log in|sign in|continue with/i }).first().waitFor({ state: "visible" }),
      this.page!.waitForURL(/auth|login|sign-in/i)
    ]).catch(() => undefined);
  }

  private async isAuthenticationRequired(): Promise<boolean> {
    const page = this.page!;
    if (/auth|login|sign-in/i.test(page.url())) return true;
    const login = page.getByRole("button", { name: /log in|sign in|continue with/i }).or(
      page.getByRole("link", { name: /log in|sign in/i })
    ).first();
    return login.isVisible().catch(() => false);
  }

  private async refreshAuthentication(): Promise<void> {
    if (!this.headless) {
      throw new Error("Leonardo session has expired. Sign in in the open browser window, then run the command again.");
    }

    await this.close();
    console.log("Leonardo session expired. Opening normal Chrome for sign-in...");
    console.log("Complete sign-in, reach Leonardo, then close that Chrome window to continue headlessly.");
    await this.runInteractiveAuthentication();

    console.log("Leonardo sign-in restored. Returning to headless mode...");
    await this.launch(true);
    await this.openGenerator();
    if (await this.isAuthenticationRequired()) {
      throw new Error("Leonardo authentication did not persist. Use the same login method originally used to create the account, then close the authentication window.");
    }
  }

  private async runInteractiveAuthentication(): Promise<void> {
    if (!this.executablePath) throw new Error("A Chrome executable path is required for interactive Leonardo authentication");
    const child = spawn(this.executablePath, [
      `--user-data-dir=${this.userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      this.generatorUrl
    ], { stdio: "ignore" });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Leonardo authentication window was not closed within ${Math.round(this.authenticationTimeoutMs / 60000)} minutes`));
      }, this.authenticationTimeoutMs);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private classifyError(error: unknown): LeonardoGenerationError {
    if (error instanceof LeonardoGenerationError) return error;
    const message = error instanceof Error ? error.message : String(error);
    if (/log in|sign in|authentication|session.*expired/i.test(message)) {
      return new LeonardoGenerationError(message, "authentication", false);
    }
    if (/credit|token|insufficient|upgrade|subscription|plan limit/i.test(message)) {
      return new LeonardoGenerationError(`Leonardo has insufficient generation credits or plan capacity: ${message}`, "credits", false);
    }
    if (/moderation|content policy|not allowed|unsafe|flagged|safety/i.test(message)) {
      return new LeonardoGenerationError(message, "moderation", true);
    }
    if (/rate limit|too many|429|slow down/i.test(message)) {
      return new LeonardoGenerationError(message, "rate-limit", true);
    }
    return new LeonardoGenerationError(message, "generation", true);
  }

  private revisePrompt(prompt: string, kind: GenerationFailureKind, attempt: number): string {
    const neutral = prompt
      .replace(/\b(blood|bloody|gore|gory|corpse|dead body|murder|killing|weapon|gun|rifle|bomb|explosion)\b/gi, "serious news event")
      .replace(/\b(logo|trademark|brand mark|watermark|celebrity likeness|exact likeness)\b/gi, "unbranded visual")
      .replace(/\s+/g, " ")
      .trim();
    const subject = neutral.slice(0, attempt >= 2 ? 650 : 1_000);
    if (kind === "rate-limit") return subject;
    return `${subject}. Neutral factual editorial illustration, symbolic rather than graphic, respectful people, no injury detail, no weapons, no logos, no readable text, no watermark, original composition.`;
  }

  private async saveDiagnostics(attempt: number, prompt: string, error: unknown): Promise<void> {
    const page = this.page;
    if (!page) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.resolve("work", "leonardo-diagnostics", stamp);
    await fs.mkdir(dir, { recursive: true });
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    await Promise.all([
      fs.writeFile(path.join(dir, `attempt-${attempt}.json`), JSON.stringify({ url: page.url(), prompt, error: message }, null, 2)),
      page.screenshot({ path: path.join(dir, `attempt-${attempt}.png`), fullPage: true }).catch(() => undefined),
      page.content().then((html) => fs.writeFile(path.join(dir, `attempt-${attempt}.html`), html)).catch(() => undefined)
    ]);
  }

  private async writeImage(image: Buffer, destination: string): Promise<void> {
    const extension = path.extname(destination).toLowerCase();
    const pipeline = sharp(image);
    if (extension === ".png") await pipeline.png().toFile(destination);
    else if (extension === ".jpg" || extension === ".jpeg") await pipeline.jpeg({ quality: 95 }).toFile(destination);
    else if (extension === ".webp") await pipeline.webp({ quality: 95 }).toFile(destination);
    else await fs.writeFile(destination, image);
  }
}

export async function generateLeonardoImage(
  request: LeonardoImageRequest,
  options?: LeonardoImageServiceOptions
): Promise<string> {
  const service = new LeonardoImageService(options);
  try {
    return await service.generate(request);
  } finally {
    await service.close();
  }
}
