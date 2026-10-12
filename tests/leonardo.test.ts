import assert from "node:assert/strict";
import { test } from "node:test";
import { isLeonardoGeneratedImage } from "../src/leonardo.js";

test("accepts the current Leonardo generation CDN", () => {
  assert.equal(isLeonardoGeneratedImage("https://cdn.leonardo.ai/users/user/generations/id/image.jpg", "image/jpeg", 30_000), true);
  assert.equal(isLeonardoGeneratedImage("https://assets.leonardo.ai/users/user/generations/id/image.avif", "image/avif"), true);
});

test("ignores unrelated images and lookalike hosts", () => {
  assert.equal(isLeonardoGeneratedImage("https://cdn.leonardo.ai/logo.png", "image/png", 100_000), false);
  assert.equal(isLeonardoGeneratedImage("https://cdn.leonardo.ai.example.com/generations/id/image.jpg", "image/jpeg", 100_000), false);
  assert.equal(isLeonardoGeneratedImage("https://cdn.leonardo.ai/generations/id/image.jpg", "text/html", 100_000), false);
});
