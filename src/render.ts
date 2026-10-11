import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { config } from "./config.js";
import type { VideoContent } from "./types.js";

const ffmpeg = ffmpegPath as unknown as string;

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const wrap = (text: string, max = 48) => {
  const words = text.split(/\s+/); const lines: string[] = []; let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > max) { lines.push(line); line = word; } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines;
};

export async function renderVideo(content: VideoContent): Promise<string> {
  if (!ffmpeg) throw new Error("ffmpeg-static did not provide an FFmpeg binary");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const workDir = path.resolve("work", stamp);
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(config.OUTPUT_DIR, { recursive: true });

  try {
  const segments: string[] = [];
  // VIDEO_DURATION_SECONDS is a ceiling, not a target. Narrated scenes retain
  // their natural speech length plus a small visual tail instead of having
  // their audio stretched to fill an arbitrary one-minute timeline.
  const naturalDurations = content.scenes.map((scene) => scene.audioDurationSeconds
    ? scene.audioDurationSeconds + 0.25
    : scene.durationSeconds);
  const naturalTotal = naturalDurations.reduce((sum, duration) => sum + duration, 0);
  const durationScale = naturalTotal > config.VIDEO_DURATION_SECONDS
    ? config.VIDEO_DURATION_SECONDS / naturalTotal
    : 1;
  const durations = naturalDurations.map((duration) => duration * durationScale);
  const portrait = config.VIDEO_HEIGHT > config.VIDEO_WIDTH;
  for (const [index, scene] of content.scenes.entries()) {
    const durationSeconds = Math.max(0.1, durations[index]);
    scene.durationSeconds = durationSeconds;
    const headingY = portrait ? 1080 : 250;
    const headingLines = wrap(scene.heading, portrait ? 23 : 38);
    const headingMarkup = headingLines.map((line, i) => `<text x="80" y="${headingY + i * (portrait ? 78 : 64)}" class="h">${esc(line)}</text>`).join("");
    const bodyY = headingY + headingLines.length * (portrait ? 78 : 64) + (portrait ? 55 : 40);
    const footerY = config.VIDEO_HEIGHT - 70;
    const bodyLines = wrap(scene.body, portrait ? 30 : 48).map((line, i) => `<text x="80" y="${bodyY + i * (portrait ? 64 : 54)}" class="body">${esc(line)}</text>`).join("");
    const svg = `<svg width="${config.VIDEO_WIDTH}" height="${config.VIDEO_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#030712" stop-opacity=".25"/><stop offset="1" stop-color="#030712" stop-opacity=".94"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <style>.k{font:600 ${portrait ? 30 : 24}px sans-serif;fill:#c4b5fd}.h{font:700 ${portrait ? 66 : 54}px sans-serif;fill:white}.body{font:${portrait ? 40 : 32}px sans-serif;fill:#e5e7eb}</style>
      <text x="80" y="115" class="k">${esc(content.title.toUpperCase())}</text>${headingMarkup}${bodyLines}
      <text x="80" y="${footerY}" class="k">${index + 1} / ${content.scenes.length}  •  #SHORTS</text></svg>`;
    const image = path.join(workDir, `scene-${index}.png`);
    const segment = path.join(workDir, `segment-${index}.mp4`);
    const canvas = scene.imagePath
      ? sharp(scene.imagePath).resize(config.VIDEO_WIDTH, config.VIDEO_HEIGHT, { fit: "cover" })
      : sharp({ create: { width: config.VIDEO_WIDTH, height: config.VIDEO_HEIGHT, channels: 4, background: "#312e81" } });
    await canvas.composite([{ input: Buffer.from(svg) }]).png().toFile(image);
    const narrated = Boolean(scene.audioPath);
    const videoFilter = [
      `zoompan=z='min(zoom+0.0007,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${config.VIDEO_WIDTH}x${config.VIDEO_HEIGHT}:fps=${config.FPS}`,
      "format=yuv420p"
    ].join(",");
    const args = ["-y", "-loop", "1", "-framerate", String(config.FPS), "-i", image];
    if (narrated) args.push("-i", scene.audioPath!);
    else args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
    // Only accelerate audio when enforcing the maximum duration. Never slow
    // narration merely to fill unused time.
    const speedRatio = narrated
      ? Math.max(1, (scene.audioDurationSeconds ?? durationSeconds) / durationSeconds)
      : 1;
    const tempoFilters: string[] = [];
    let remainingTempo = speedRatio;
    while (remainingTempo > 2) { tempoFilters.push("atempo=2"); remainingTempo /= 2; }
    while (remainingTempo < 0.5) { tempoFilters.push("atempo=0.5"); remainingTempo /= 0.5; }
    if (Math.abs(remainingTempo - 1) > 0.01) tempoFilters.push(`atempo=${remainingTempo.toFixed(4)}`);
    args.push(
      "-t", String(durationSeconds),
      "-map", "0:v:0", "-map", "1:a:0",
      "-vf", videoFilter,
      "-af", ["aresample=48000", ...tempoFilters, "apad", "loudnorm=I=-16:TP=-1.5:LRA=11"].join(","),
      "-c:v", "libx264", "-preset", config.VIDEO_PRESET, "-crf", String(config.VIDEO_CRF),
      "-profile:v", "high", "-level:v", "4.1", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", config.AUDIO_BITRATE, "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart", segment
    );
    await run(ffmpeg, args);
    segments.push(segment);
  }

  const listFile = path.join(workDir, "segments.txt");
  await fs.writeFile(listFile, segments.map((p) => `file '${p.replaceAll("'", "'\\''")}'`).join("\n"));
  const output = path.join(config.OUTPUT_DIR, `${stamp}.mp4`);
  await run(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", output]);
  await fs.writeFile(output.replace(/\.mp4$/, ".json"), JSON.stringify(content, null, 2));
  return output;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
