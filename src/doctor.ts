import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { config } from "./config.js";
import { defaultChromePath, defaultVoiceStudioPath } from "./platform.js";

function commandVersion(command: string, args = ["--version"]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0
      ? resolve((output || errorOutput).trim().split("\n")[0])
      : reject(new Error(`exit ${code}`)));
  });
}

async function accessibleFile(file: string): Promise<string> {
  await fs.access(file);
  return file;
}

export async function doctor() {
  const aiCheck: [string, () => Promise<string>] = config.AI_PROVIDER === "codex"
    ? ["Codex CLI", () => commandVersion(config.CODEX_COMMAND)]
    : ["Ollama", async () => {
      const response = await fetch(`${config.OLLAMA_BASE_URL}/api/tags`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { models?: Array<{ name: string }> };
      const models = data.models?.map((model) => model.name) ?? [];
      if (!models.some((model) => model === config.OLLAMA_MODEL || model.startsWith(`${config.OLLAMA_MODEL}:`))) throw new Error(`running, but ${config.OLLAMA_MODEL} is not pulled`);
      return `${config.OLLAMA_MODEL} ready`;
    }];
  const checks: Array<[string, () => Promise<string>, boolean?]> = [
    ["Node.js", async () => {
      const major = Number(process.versions.node.split(".")[0]);
      if (major < 20) throw new Error(`20+ required; found ${process.versions.node}`);
      return process.versions.node;
    }],
    ["FFmpeg", async () => accessibleFile(ffmpegPath as unknown as string)],
    ["Environment file", async () => accessibleFile(path.resolve(".env"))],
    ["Output directory", async () => {
      await fs.mkdir(config.OUTPUT_DIR, { recursive: true });
      await fs.access(config.OUTPUT_DIR, fs.constants.W_OK);
      return config.OUTPUT_DIR;
    }],
    aiCheck
  ];
  if (config.IMAGE_MODE === "comfyui") checks.push(["ComfyUI", async () => {
      const response = await fetch(`${config.COMFYUI_BASE_URL}/object_info`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return `${config.COMFYUI_CHECKPOINT} configured`;
    }]);
  if (config.IMAGE_MODE === "leonardo") {
    checks.push(["Chrome for Leonardo", async () => accessibleFile(config.LEONARDO_CHROME_PATH ?? defaultChromePath() ?? "Chrome executable not detected; set LEONARDO_CHROME_PATH")]);
  }
  if (config.NARRATION_PROVIDER === "voicestudio") {
    checks.push(["VoiceStudio application", async () => accessibleFile(config.VOICESTUDIO_APP_PATH ?? defaultVoiceStudioPath() ?? "VoiceStudio executable not detected; set VOICESTUDIO_APP_PATH")]);
    checks.push(["Chrome for Clipchamp fallback", async () => accessibleFile(config.CLIPCHAMP_CHROME_PATH ?? defaultChromePath() ?? "Chrome executable not detected; set CLIPCHAMP_CHROME_PATH")]);
  }
  if (config.YOUTUBE_UPLOAD_ENABLED) {
    checks.push(["YouTube OAuth client", async () => accessibleFile(config.YOUTUBE_CLIENT_SECRET_FILE)]);
    checks.push(["YouTube OAuth token", async () => accessibleFile(config.YOUTUBE_TOKEN_FILE)]);
  }
  checks.push(["Piper voice", async () => {
      await fs.access(config.PIPER_MODEL);
      return config.PIPER_MODEL;
    }, true]);
  let failed = false;
  for (const [name, check, optional = false] of checks) {
    try { console.log(`✓ ${name}: ${await check()}`); }
    catch (error) {
      if (!optional) failed = true;
      console.error(`${optional ? "!" : "✗"} ${name}${optional ? " (optional)" : ""}: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (failed) process.exitCode = 1;
}
