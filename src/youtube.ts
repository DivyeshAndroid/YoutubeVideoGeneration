import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { google } from "googleapis";
import { config } from "./config.js";
import type { VideoContent } from "./types.js";

const scope = ["https://www.googleapis.com/auth/youtube.upload"];

async function oauthClient() {
  let credentials;
  try { credentials = JSON.parse(await fsp.readFile(config.YOUTUBE_CLIENT_SECRET_FILE, "utf8")); }
  catch (error) {
    throw new Error(`Cannot load YouTube OAuth client JSON at ${config.YOUTUBE_CLIENT_SECRET_FILE}. Supply this file before enabling publishing.`, { cause: error });
  }
  const data = credentials.installed ?? credentials.web;
  if (!data?.client_id || !data?.client_secret) throw new Error("YouTube OAuth client JSON must contain an installed or web OAuth client");
  const client = new google.auth.OAuth2(data.client_id, data.client_secret, "http://localhost:53682/oauth2callback");
  try { client.setCredentials(JSON.parse(await fsp.readFile(config.YOUTUBE_TOKEN_FILE, "utf8"))); } catch { /* auth command creates it */ }
  client.on("tokens", async (tokens) => {
    const current = await fsp.readFile(config.YOUTUBE_TOKEN_FILE, "utf8").then(JSON.parse).catch(() => ({}));
    await fsp.mkdir(path.dirname(config.YOUTUBE_TOKEN_FILE), { recursive: true });
    await fsp.writeFile(config.YOUTUBE_TOKEN_FILE, JSON.stringify({ ...current, ...tokens }, null, 2));
  });
  return client;
}

export async function verifyYouTubeUploadAuthorization(): Promise<void> {
  if (!config.YOUTUBE_UPLOAD_ENABLED) return;
  const client = await oauthClient();
  if (!client.credentials.refresh_token && !client.credentials.access_token) {
    throw new Error(`YouTube authorization is missing at ${config.YOUTUBE_TOKEN_FILE}. Run npm run youtube-auth and sign in to your channel before publishing.`);
  }
  const access = await client.getAccessToken();
  if (!access.token) throw new Error("YouTube authorization could not obtain an access token; run npm run youtube-auth again");
}

export async function authorizeYouTube(): Promise<void> {
  const client = await oauthClient();
  const url = client.generateAuthUrl({ access_type: "offline", scope, prompt: "consent" });
  console.log(`Open this URL in your browser:\n${url}`);
  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const code = new URL(req.url!, "http://localhost:53682").searchParams.get("code");
        if (!code) return;
        const { tokens } = await client.getToken(code); client.setCredentials(tokens);
        await fsp.mkdir(path.dirname(config.YOUTUBE_TOKEN_FILE), { recursive: true });
        await fsp.writeFile(config.YOUTUBE_TOKEN_FILE, JSON.stringify(tokens, null, 2));
        res.end("YouTube authorization complete. You can close this tab."); server.close(); resolve();
      } catch (error) { reject(error); }
    }).listen(53682);
  });
}

export async function uploadVideo(videoPath: string, content: VideoContent): Promise<string> {
  if (!config.YOUTUBE_UPLOAD_ENABLED) {
    console.log("Upload skipped: YOUTUBE_UPLOAD_ENABLED is false.");
    return "dry-run";
  }
  const auth = await oauthClient();
  const youtube = google.youtube({ version: "v3", auth });
  const sources = content.sources?.length
    ? `\n\nSources:\n${content.sources.map((source) => `- ${source.title}: ${source.url}`).join("\n")}`
    : "";
  const hashtags = normalizeHashtags(content.hashtags ?? []);
  const hashtagLine = hashtags.length ? `\n\n${hashtags.join(" ")}` : "";
  const disclosure = "\n\nDisclosure: This video uses an AI-generated narration voice.";
  const result = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: { snippet: { title: content.title, description: `${content.description}${hashtagLine}${sources}${disclosure}`.slice(0, 5000), tags: [...content.tags, ...hashtags.map((tag) => tag.slice(1))] }, status: { privacyStatus: config.YOUTUBE_PRIVACY_STATUS } },
    media: { body: fs.createReadStream(videoPath) }
  });
  if (!result.data.id) throw new Error("YouTube upload returned no video ID");
  return result.data.id;
}

function normalizeHashtags(input: string[]): string[] {
  const normalized = input
    .map((tag) => `#${tag.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")}`)
    .filter((tag) => tag.length > 1);
  if (!normalized.some((tag) => tag.toLowerCase() === "#shorts")) normalized.unshift("#Shorts");
  return [...new Map(normalized.map((tag) => [tag.toLowerCase(), tag])).values()].slice(0, config.HASHTAG_COUNT);
}
