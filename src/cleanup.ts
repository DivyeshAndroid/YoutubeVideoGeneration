import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config } from "./config.js";
import type { VideoContent } from "./types.js";

const workRoot = path.resolve("work");
const narrationRoot = path.join(workRoot, "narration");
const generatedImageRoot = path.join(workRoot, "generated-images");

function isWithin(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function removeRunDirectories(paths: Array<string | undefined>, allowedRoot: string): Promise<void> {
  const directories = new Set(
    paths
      .filter((value): value is string => Boolean(value))
      .map((value) => path.dirname(path.resolve(value)))
      .filter((directory) => isWithin(directory, allowedRoot))
  );
  await Promise.all([...directories].map((directory) => fs.rm(directory, { recursive: true, force: true })));
}

function runQuietly(command: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", () => resolve());
    child.on("exit", () => resolve());
  });
}

export async function cleanupPipelineRun(content?: VideoContent): Promise<void> {
  if (content) {
    await removeRunDirectories(content.scenes.map((scene) => scene.audioPath), narrationRoot);
    await removeRunDirectories(content.scenes.map((scene) => scene.imagePath), generatedImageRoot);
  }

  if (process.platform === "darwin" && config.NARRATION_PROVIDER === "voicestudio") {
    await runQuietly("/usr/bin/osascript", ["-e", "tell application \"VoiceStudio\" to quit"]);
  }
}
