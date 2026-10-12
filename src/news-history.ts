import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config } from "./config.js";
import { canonicalUrl, normalizedTitle } from "./news.js";
import type { NewsItem } from "./news.js";
import type { VideoContent } from "./types.js";

const entrySchema = z.object({
  url: z.string().url(), title: z.string(), summary: z.string(), videoPath: z.string()
});
const historySchema = z.object({ version: z.literal(1), stories: z.array(entrySchema) });
export type UsedStory = z.infer<typeof entrySchema>;

export function storiesFromVideo(content: VideoContent, videoPath: string): UsedStory[] {
  return content.scenes.flatMap((scene) => {
    if (!scene.sourceUrl || scene.kind === "subscribe") return [];
    const source = content.sources?.find((source) => canonicalUrl(source.url) === canonicalUrl(scene.sourceUrl!));
    return [{ url: canonicalUrl(scene.sourceUrl), title: scene.newsTitle ?? source?.title ?? scene.heading,
      summary: `${scene.heading}. ${scene.body}`, videoPath }];
  });
}

export async function loadNewsHistory(historyFile = config.NEWS_HISTORY_FILE, outputDir = config.OUTPUT_DIR): Promise<UsedStory[]> {
  let saved: UsedStory[] = [];
  try { saved = historySchema.parse(JSON.parse(await fs.readFile(historyFile, "utf8"))).stories; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  // Completed output videos recover history after a failed write, and cover
  // videos generated before the ledger was introduced. Previews without sources do not count.
  let files: string[];
  try { files = await fs.readdir(outputDir); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return saved; throw error; }
  const byUrl = new Map(saved.map((story) => [canonicalUrl(story.url), story]));
  for (const file of files.filter((file) => file.endsWith(".json"))) {
    const videoPath = path.resolve(outputDir, file.replace(/\.json$/, ".mp4"));
    try { await fs.access(videoPath); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    const content = JSON.parse(await fs.readFile(path.join(outputDir, file), "utf8")) as VideoContent;
    if (!Array.isArray(content.scenes)) continue;
    for (const story of storiesFromVideo(content, videoPath)) {
      const valid = entrySchema.parse(story);
      if (!byUrl.has(valid.url)) byUrl.set(valid.url, valid);
    }
  }
  return [...byUrl.values()];
}

export function filterKnownStories(items: NewsItem[], history: UsedStory[]): NewsItem[] {
  const urls = new Set(history.map((story) => canonicalUrl(story.url)));
  const titles = new Set(history.map((story) => normalizedTitle(story.title)));
  return items.filter((item) => !urls.has(canonicalUrl(item.url)) && !titles.has(normalizedTitle(item.title)));
}

export async function recordUsedStories(content: VideoContent, videoPath: string,
  historyFile = config.NEWS_HISTORY_FILE, outputDir = config.OUTPUT_DIR): Promise<void> {
  const stories = new Map((await loadNewsHistory(historyFile, outputDir)).map((story) => [story.url, story]));
  for (const story of storiesFromVideo(content, videoPath)) stories.set(story.url, story);
  await fs.mkdir(path.dirname(path.resolve(historyFile)), { recursive: true });
  const temp = `${historyFile}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify({ version: 1, stories: [...stories.values()] }, null, 2));
    await fs.rename(temp, historyFile);
  } finally { await fs.rm(temp, { force: true }); }
}

export async function acquirePipelineLock(lockFile = path.resolve("work", "pipeline.lock")): Promise<() => Promise<void>> {
  await fs.mkdir(path.dirname(lockFile), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const file = await fs.open(lockFile, "wx");
      try { await file.writeFile(JSON.stringify({ pid: process.pid })); }
      finally { await file.close(); }
      return () => fs.unlink(lockFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Serialize stale-lock recovery so competing jobs cannot remove a
      // replacement lock owned by a job that has just started.
      const recoveryPath = `${lockFile}.recovery`;
      let recovery;
      try { recovery = await fs.open(recoveryPath, "wx"); }
      catch (recoveryError) {
        if ((recoveryError as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Another job is checking the pipeline lock; try again later.");
        throw recoveryError;
      }
      try {
        let raw: string;
        try { raw = await fs.readFile(lockFile, "utf8"); }
        catch (readError) { if ((readError as NodeJS.ErrnoException).code === "ENOENT") continue; throw readError; }
        const owner = z.object({ pid: z.number().int().positive() }).parse(JSON.parse(raw));
        try { process.kill(owner.pid, 0); }
        catch (checkError) {
          if ((checkError as NodeJS.ErrnoException).code !== "ESRCH") throw checkError;
          await fs.unlink(lockFile);
          continue;
        }
        throw new Error("A video job is already running; refusing an overlapping run.");
      } finally {
        await recovery.close();
        await fs.unlink(recoveryPath);
      }
    }
  }
  throw new Error("Could not acquire the video job lock");
}
