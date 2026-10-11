import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export type VoiceStudioRequest = {
  text: string;
  destinationPath: string;
  language?: string;
  profileId?: string;
  instruct?: string;
  speed?: number;
  steps?: number;
};

export type VoiceStudioServiceOptions = {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  autoStart?: boolean;
  executablePath?: string;
  startupTimeoutMs?: number;
};

const defaultExecutable = process.platform === "darwin"
  ? "/Applications/VoiceStudio.app/Contents/MacOS/VoiceStudio"
  : undefined;

/** Uses the local API provided by the installed VoiceStudio desktop app. */
export class VoiceStudioService {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly autoStart: boolean;
  private readonly executablePath?: string;
  private readonly startupTimeoutMs: number;

  constructor(options: VoiceStudioServiceOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:3900").replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.autoStart = options.autoStart ?? true;
    this.executablePath = options.executablePath ?? defaultExecutable;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 120_000;
  }

  async start(): Promise<void> {
    if (await this.isReady()) return;
    if (!this.autoStart || !this.executablePath) {
      throw new Error(`VoiceStudio is not reachable at ${this.baseUrl}. Open VoiceStudio and retry.`);
    }

    await fs.access(this.executablePath);
    const child = spawn(this.executablePath, [], { detached: true, stdio: "ignore" });
    child.unref();

    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      if (await this.isReady()) return;
    }
    throw new Error(`VoiceStudio did not become ready at ${this.baseUrl} within ${this.startupTimeoutMs}ms`);
  }

  async synthesize(request: VoiceStudioRequest): Promise<string> {
    if (!request.text.trim()) throw new Error("VoiceStudio narration text cannot be empty");
    await this.start();

    const form = new FormData();
    form.set("text", request.text);
    form.set("language", request.language || "Auto");
    form.set("speed", String(request.speed ?? 1));
    form.set("num_step", String(request.steps ?? 16));
    if (request.profileId) form.set("profile_id", request.profileId);
    if (request.instruct) form.set("instruct", request.instruct);

    const response = await fetch(`${this.baseUrl}/generate`, {
      method: "POST",
      headers: this.headers(),
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1_000);
      throw new Error(`VoiceStudio generation failed (HTTP ${response.status}): ${detail || response.statusText}`);
    }

    const destination = path.resolve(request.destinationPath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
    const stat = await fs.stat(destination);
    if (stat.size < 1_024) throw new Error(`VoiceStudio produced an unexpectedly small audio file: ${destination}`);
    return destination;
  }

  private headers(): HeadersInit {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }

  private async isReady(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(2_000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export async function generateVoiceStudioAudio(
  request: VoiceStudioRequest,
  options?: VoiceStudioServiceOptions
): Promise<string> {
  return new VoiceStudioService(options).synthesize(request);
}
