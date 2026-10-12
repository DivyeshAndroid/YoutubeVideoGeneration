import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { google } from "googleapis";
import { config } from "../src/config.js";
import { verifyYouTubeUploadAuthorization } from "../src/youtube.js";

test("publishing preflight fails before generation when OAuth files are missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-auth-check-"));
  const previous = { enabled: config.YOUTUBE_UPLOAD_ENABLED, client: config.YOUTUBE_CLIENT_SECRET_FILE, token: config.YOUTUBE_TOKEN_FILE };
  try {
    config.YOUTUBE_UPLOAD_ENABLED = false;
    config.YOUTUBE_CLIENT_SECRET_FILE = path.join(root, "client.json");
    config.YOUTUBE_TOKEN_FILE = path.join(root, "token.json");
    await verifyYouTubeUploadAuthorization();
    config.YOUTUBE_UPLOAD_ENABLED = true;
    await assert.rejects(verifyYouTubeUploadAuthorization(), /Cannot load YouTube OAuth client JSON/);
    await fs.writeFile(config.YOUTUBE_CLIENT_SECRET_FILE, JSON.stringify({ installed: { client_id: "test-id", client_secret: "test-secret" } }));
    await assert.rejects(verifyYouTubeUploadAuthorization(), /YouTube authorization is missing/);
  } finally {
    config.YOUTUBE_UPLOAD_ENABLED = previous.enabled;
    config.YOUTUBE_CLIENT_SECRET_FILE = previous.client;
    config.YOUTUBE_TOKEN_FILE = previous.token;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("publishing preflight checks saved tokens and fails closed when refresh fails", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-token-check-"));
  const previous = { enabled: config.YOUTUBE_UPLOAD_ENABLED, client: config.YOUTUBE_CLIENT_SECRET_FILE, token: config.YOUTUBE_TOKEN_FILE };
  try {
    config.YOUTUBE_UPLOAD_ENABLED = true;
    config.YOUTUBE_CLIENT_SECRET_FILE = path.join(root, "client.json");
    config.YOUTUBE_TOKEN_FILE = path.join(root, "token.json");
    await fs.writeFile(config.YOUTUBE_CLIENT_SECRET_FILE, JSON.stringify({ installed: { client_id: "test-id", client_secret: "test-secret" } }));
    await fs.writeFile(config.YOUTUBE_TOKEN_FILE, JSON.stringify({ refresh_token: "test-refresh-token" }));
    const refresh = t.mock.method(google.auth.OAuth2.prototype, "getAccessToken", async () => ({ token: "test-access-token" }));
    await verifyYouTubeUploadAuthorization();
    assert.equal(refresh.mock.callCount(), 1);
    refresh.mock.mockImplementation(async () => { throw new Error("Refresh revoked"); });
    await assert.rejects(verifyYouTubeUploadAuthorization(), /Refresh revoked/);
  } finally {
    config.YOUTUBE_UPLOAD_ENABLED = previous.enabled;
    config.YOUTUBE_CLIENT_SECRET_FILE = previous.client;
    config.YOUTUBE_TOKEN_FILE = previous.token;
    await fs.rm(root, { recursive: true, force: true });
  }
});
