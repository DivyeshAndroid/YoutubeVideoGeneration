import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { acquirePipelineLock, filterKnownStories, loadNewsHistory, recordUsedStories } from "../src/news-history.js";
import { filterNovelCoverage } from "../src/content.js";
import type { NewsItem } from "../src/news.js";
import type { VideoContent } from "../src/types.js";

const content: VideoContent = { title: "World news", description: "Roundup", tags: [], scenes: [
  { heading: "English translation", body: "The actual event", newsTitle: "Original headline", durationSeconds: 8, sourceUrl: "https://example.com/event?utm_source=feed" },
  { kind: "subscribe", heading: "SUBSCRIBE", body: "Subscribe", durationSeconds: 5 }
] };
const candidate: NewsItem = { title: "New headline", url: "https://another.com/report", publishedAt: "", source: "BBC", provider: "world-rss" };

test("history imports completed videos, persists across restarts, and ignores previews/incomplete metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "news-history-"));
  try {
    const ledger = path.join(root, "history.json");
    await fs.writeFile(path.join(root, "old.json"), JSON.stringify(content));
    await fs.writeFile(path.join(root, "old.mp4"), "completed fixture");
    await fs.writeFile(path.join(root, "incomplete.json"), JSON.stringify({ ...content, scenes: [{ ...content.scenes[0], sourceUrl: "https://example.com/other" }] }));
    const initial = await loadNewsHistory(ledger, root);
    assert.equal(initial.length, 1);
    assert.equal(initial[0].url, "https://example.com/event");
    assert.equal(initial[0].title, "Original headline");
    await recordUsedStories(content, path.join(root, "new.mp4"), ledger, root);
    const restarted = await loadNewsHistory(ledger, root);
    assert.equal(restarted.length, 1);
    assert.equal(restarted[0].summary, "English translation. The actual event");
    assert.equal(filterKnownStories([{ ...candidate, url: "https://example.com/event?ref=other" }], restarted).length, 0);
    assert.equal(filterKnownStories([{ ...candidate, title: "Original headline - BBC" }], restarted).length, 0);
    await fs.unlink(path.join(root, "old.mp4"));
    assert.equal((await loadNewsHistory(ledger, root)).length, 1);
    await fs.writeFile(ledger, "corrupt ledger");
    await assert.rejects(loadNewsHistory(ledger, root));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("semantic duplicate check includes prior English narration and rejects translated/reworded events", async () => {
  const history = [{ url: "https://example.com/old", title: "Previously covered event", summary: "English narration of the event", videoPath: "old.mp4" }];
  let calls = 0;
  const result = await filterNovelCoverage([candidate, { ...candidate, url: "https://another.com/new", title: "Unrelated event" }], history, async (prompt) => {
    calls += 1;
    assert.match(prompt, /Hindi or English/);
    assert.match(prompt, /English narration of the event/);
    return JSON.stringify({ newIndices: [1] });
  });
  assert.equal(calls, 1);
  assert.equal(result[0].title, "Unrelated event");
});

test("novelty checks every history batch and rejects invalid AI indices", async () => {
  const history = Array.from({ length: 101 }, (_, index) => ({ url: `https://old.com/${index}`, title: `Old ${index}`, summary: "Past story", videoPath: "old.mp4" }));
  let calls = 0;
  const result = await filterNovelCoverage([candidate], history, async () => JSON.stringify({ newIndices: ++calls === 1 ? [0] : [] }));
  assert.equal(calls, 2);
  assert.deepEqual(result, []);
  for (const newIndices of [[3], [0, 0], [-1]]) {
    await assert.rejects(filterNovelCoverage([candidate], [], async () => JSON.stringify({ newIndices })));
  }
});

test("job lock prevents concurrent videos and allows a new job after release", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "news-lock-"));
  try {
    const file = path.join(root, "pipeline.lock");
    const release = await acquirePipelineLock(file);
    await assert.rejects(acquirePipelineLock(file), /already running/);
    await release();
    await (await acquirePipelineLock(file))();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("competing jobs recovering a dead process lock cannot both acquire it", async () => {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid!;
  await new Promise<void>((resolve, reject) => { child.once("exit", () => resolve()); child.once("error", reject); });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "news-stale-lock-"));
  try {
    const file = path.join(root, "pipeline.lock");
    await fs.writeFile(file, JSON.stringify({ pid }));
    const results = await Promise.allSettled([acquirePipelineLock(file), acquirePipelineLock(file)]);
    const winners = results.filter((result) => result.status === "fulfilled");
    assert.equal(winners.length, 1);
    for (const result of winners) { if (result.status === "fulfilled") await result.value(); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
