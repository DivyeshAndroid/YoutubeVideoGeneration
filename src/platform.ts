import fs from "node:fs";
import path from "node:path";

function firstExisting(candidates: Array<string | undefined>): string | undefined {
  return candidates
    .filter((candidate): candidate is string => Boolean(candidate))
    .find((candidate) => fs.existsSync(candidate));
}

export function installedCodexPath(binDir = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin") : ""): string | undefined {
  if (!binDir || !fs.existsSync(binDir)) return undefined;
  const candidates = fs.readdirSync(binDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(binDir, entry.name, "codex.exe"))
    .filter((file) => fs.existsSync(file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0];
}

export function defaultChromePath(): string | undefined {
  if (process.platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.platform !== "win32") return undefined;
  return firstExisting([
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.env["PROGRAMFILES(X86)"] ? path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : undefined
  ]);
}

export function defaultVoiceStudioPath(): string | undefined {
  if (process.platform === "darwin") return "/Applications/VoiceStudio.app/Contents/MacOS/VoiceStudio";
  if (process.platform !== "win32") return undefined;
  return firstExisting([
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "VoiceStudio", "VoiceStudio.exe") : undefined,
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, "VoiceStudio", "VoiceStudio.exe") : undefined,
    process.env["PROGRAMFILES(X86)"] ? path.join(process.env["PROGRAMFILES(X86)"], "VoiceStudio", "VoiceStudio.exe") : undefined
  ]);
}
