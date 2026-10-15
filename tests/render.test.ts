import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { config } from "../src/config.js";
import { renderVideo } from "../src/render.js";

test("rendering reads source images into memory so Windows cleanup can delete them", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "news-render-"));
  const previous = { output: config.OUTPUT_DIR, fps: config.FPS, preset: config.VIDEO_PRESET };
  try {
    const imagePath = path.join(root, "scene.source");
    await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#328870" } }).jpeg().toFile(imagePath);
    const read = t.mock.method(fs, "readFile");
    config.OUTPUT_DIR = path.join(root, "output");
    config.FPS = 1;
    config.VIDEO_PRESET = "ultrafast";
    const video = await renderVideo({ title: "Render check", description: "Local fixture", tags: [], scenes: [
      { heading: "Image check", body: "Source cleanup check.", durationSeconds: 0.2, imagePath }
    ] });
    assert.ok(read.mock.calls.some((call) => call.arguments[0] === imagePath));
    assert.ok((await fs.stat(video)).size > 1024);
    await fs.unlink(imagePath);
    await assert.rejects(fs.access(imagePath), { code: "ENOENT" });
  } finally {
    config.OUTPUT_DIR = previous.output;
    config.FPS = previous.fps;
    config.VIDEO_PRESET = previous.preset;
    await fs.rm(root, { recursive: true, force: true });
  }
});
