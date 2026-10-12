import assert from "node:assert/strict";
import test from "node:test";
import { collectFreshNews, NoFreshNewsError } from "../src/news.js";
import type { NewsItem } from "../src/news.js";
import { parseBhaskarWorld, parseWorldFeed } from "../src/news-sources.js";

const now = Date.now();
const story = (id: number): NewsItem => ({ title: `Distinct event ${id}`, url: `https://example.com/${id}`,
  publishedAt: new Date(now - 1000).toISOString(), source: "Example", provider: "world-rss" });

test("Bhaskar parses public story data in editorial order, ignoring widgets and locked stories", () => {
  const item = (id: number, articleLockType = "NONE") => ({ type: "story", data: {
    shortUrl: `/international/news/event-${id}.html`, publishTime: "2026-10-12T19:40:03+05:30",
    articleLockType, header: { slug: `Event ${id}`, title: "Details" }
  } });
  const state = { homeData: { homePageFeedV2: { feed: [item(1), { type: "ad", data: {} }, item(2, "LOCKED"), item(3)] } } };
  const result = parseBhaskarWorld(`<script>window.INITIAL_STATE = ${JSON.stringify(state)};</script>`);
  assert.equal(result.length, 2);
  assert.equal(result[0].title, "Event 1: Details");
  assert.equal(result[1].url, "https://www.bhaskar.com/international/news/event-3.html");
  assert.equal(result[0].publishedAt, "2026-10-12T14:10:03.000Z");
  assert.throws(() => parseBhaskarWorld("<html>Sign in</html>"), /no structured story listing/);
});

test("world RSS handles CDATA, escaped titles, single entries and HTML summaries", () => {
  const result = parseWorldFeed(`<rss><channel><item><title><![CDATA[News &amp; facts]]></title>
    <link>https://example.com/world</link><pubDate>Mon, 12 Oct 2026 14:00:00 GMT</pubDate>
    <description><![CDATA[<p>Only facts.</p>]]></description></item></channel></rss>`, "BBC News");
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "News & facts");
  assert.equal(result[0].summary, "Only facts.");
  assert.equal(result[0].source, "BBC News");
});

test("primary source wins when it has five unseen stories", async () => {
  let fallbackCalled = false;
  const result = await collectFreshNews([
    { name: "Bhaskar", load: async () => [1, 2, 3, 4, 5].map(story) },
    { name: "BBC", load: async () => { fallbackCalled = true; return [story(6)]; } }
  ], async (items) => items, now);
  assert.equal(result.length, 5);
  assert.equal(fallbackCalled, false);
});

test("fallback fills only the unseen gaps, retaining primary priority", async () => {
  const result = await collectFreshNews([
    { name: "Bhaskar", load: async () => [1, 2, 3, 4, 5].map(story) },
    { name: "BBC", load: async () => [3, 6, 7, 8].map(story) }
  ], async (items) => items.filter((item) => ![story(1).url, story(2).url].includes(item.url)), now);
  assert.deepEqual(result.slice(0, 5).map((item) => item.title), [3, 4, 5, 6, 7].map((id) => story(id).title));
});

test("unavailable sources fall through, stale/future/duplicate items do not fill slots", async () => {
  const result = await collectFreshNews([
    { name: "Bhaskar", load: async () => { throw new Error("Offline"); } },
    { name: "BBC", load: async () => [story(1), story(1), { ...story(2), publishedAt: "2000-01-01" },
      { ...story(3), publishedAt: new Date(now + 3_600_000).toISOString() }] },
    { name: "Guardian", load: async () => [4, 5, 6, 7].map(story) }
  ], async (items) => items, now);
  assert.equal(result.length, 5);
});

test("exhausted sources skip, and duplicate-check failures never disable protection", async () => {
  await assert.rejects(collectFreshNews([{ name: "All", load: async () => [story(1)] }], async () => [], now), NoFreshNewsError);
  let fallbackCalled = false;
  await assert.rejects(collectFreshNews([
    { name: "Primary", load: async () => [story(1)] },
    { name: "Fallback", load: async () => { fallbackCalled = true; return [story(2)]; } }
  ], async () => { throw new Error("Checker unavailable"); }, now), /Checker unavailable/);
  assert.equal(fallbackCalled, false);
});
