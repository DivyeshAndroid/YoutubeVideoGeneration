import assert from "node:assert/strict";
import test from "node:test";
import { appendSubscribeEnding, narrationText, OUTRO_SECONDS } from "../src/outro.js";
import type { VideoContent } from "../src/types.js";

test("adds one narrated ending using the last available story image", () => {
  const content: VideoContent = { title: "News", description: "", tags: [], scenes: [
    { heading: "Story", body: "Details", durationSeconds: 10, imagePath: "photo.png" },
    { heading: "Second story", body: "More details", durationSeconds: 10 }
  ] };
  const result = appendSubscribeEnding(content);
  assert.equal(content.scenes.length, 2);
  assert.equal(result.scenes.length, 3);
  const ending = result.scenes.at(-1)!;
  assert.equal(ending.kind, "subscribe");
  assert.equal(ending.imagePath, "photo.png");
  assert.equal(ending.durationSeconds, OUTRO_SECONDS);
  assert.equal(narrationText(ending), "Subscribe for more videos. See you in the next Short!");
  assert.equal(narrationText(content.scenes[0]), "Story. Details");
  assert.deepEqual(appendSubscribeEnding(result), result);
});

test("ending works without an image", () => {
  const result = appendSubscribeEnding({ title: "Local", description: "", tags: [], scenes: [] });
  assert.equal(result.scenes.length, 1);
  assert.equal(result.scenes[0].imagePath, undefined);
});
