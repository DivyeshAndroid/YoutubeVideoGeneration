import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { config } from "../src/config.js";
import { generateSceneImages } from "../src/images.js";
import { LeonardoImageService } from "../src/leonardo.js";
import type { VideoContent } from "../src/types.js";

const content = (): VideoContent => ({
  title: "Technology news", description: "Preview", tags: [],
  scenes: [{ heading: "New AI system", body: "A new system was announced.", durationSeconds: 10, sourceUrl: "https://publisher.example/story" }]
});

for (const scenario of ["publisher image", "source failure", "missing source", "Leonardo failure"] as const) {
  test(scenario, async (t) => {
    const previous = { IMAGE_MODE: config.IMAGE_MODE, GENERATE_IMAGES: config.GENERATE_IMAGES, SCENE_IMAGE_DIR: config.SCENE_IMAGE_DIR };
    Object.assign(config, { IMAGE_MODE: "source", GENERATE_IMAGES: true, SCENE_IMAGE_DIR: undefined });
    t.after(() => Object.assign(config, previous));
    const input = content();
    if (scenario === "missing source") input.scenes[0].sourceUrl = undefined;
    t.mock.method(globalThis, "fetch", async (inputUrl: string | URL) => {
      const url = String(inputUrl);
      if (scenario !== "publisher image") throw new Error("Publisher unavailable");
      const response = new Response(url.endsWith("/story")
        ? '<meta property="og:image" content="https://publisher.example/image.png">'
        : Buffer.alloc(2048), { status: 200 });
      Object.defineProperty(response, "url", { value: url });
      return response;
    });
    const generated = t.mock.method(LeonardoImageService.prototype, "generate", async (request: { prompt: string; destinationPath: string }) => {
      assert.match(request.prompt, /New AI system/);
      if (scenario === "Leonardo failure") throw new Error("Leonardo credits exhausted");
      await fs.writeFile(request.destinationPath, Buffer.alloc(2048));
      return request.destinationPath;
    });
    const closed = t.mock.method(LeonardoImageService.prototype, "close", async () => {});
    if (scenario === "Leonardo failure") {
      await assert.rejects(generateSceneImages(input), /Leonardo credits exhausted/);
    } else {
      await generateSceneImages(input);
      const image = input.scenes[0].imagePath!;
      assert.ok(image);
      assert.equal(path.extname(image), scenario === "publisher image" ? ".source" : ".png");
      await fs.rm(path.dirname(image), { recursive: true, force: true });
    }
    assert.equal(generated.mock.callCount(), scenario === "publisher image" ? 0 : 1);
    assert.equal(closed.mock.callCount(), 1);
  });
}
