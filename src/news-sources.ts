import { load } from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import type { NewsItem } from "./news.js";

export const BHASKAR_WORLD_URL = "https://www.bhaskar.com/international/";
export const GLOBAL_NEWS_FEEDS = [
  { source: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { source: "The Guardian", url: "https://www.theguardian.com/world/rss" },
  { source: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" }
] as const;

const bhaskarState = z.object({ homeData: z.object({ homePageFeedV2: z.object({
  feed: z.array(z.object({ type: z.string(), data: z.unknown() }))
}) }) });
const bhaskarStory = z.object({
  shortUrl: z.string(), publishTime: z.string(), articleLockType: z.string(),
  header: z.object({ slug: z.string().optional(), title: z.string() })
});

export function parseBhaskarWorld(html: string): NewsItem[] {
  const $ = load(html);
  const script = $("script").toArray().map((element) => $(element).text())
    .find((text) => /^\s*window\.INITIAL_STATE\s*=/.test(text));
  if (!script) throw new Error("Bhaskar world page has no structured story listing");
  // Parse the public page's JSON payload; never execute its JavaScript.
  const json = script.replace(/^\s*window\.INITIAL_STATE\s*=\s*/, "").replace(/;\s*$/, "");
  const state = bhaskarState.parse(JSON.parse(json));
  return state.homeData.homePageFeedV2.feed.flatMap((item): NewsItem[] => {
    if (item.type !== "story") return [];
    const parsed = bhaskarStory.safeParse(item.data);
    if (!parsed.success || parsed.data.articleLockType !== "NONE") return [];
    const story = parsed.data;
    const url = new URL(story.shortUrl, BHASKAR_WORLD_URL);
    if (url.hostname !== "www.bhaskar.com" || !url.pathname.includes("/international/news/")) return [];
    const time = Date.parse(story.publishTime);
    if (!Number.isFinite(time)) return [];
    return [{
      title: [story.header.slug, story.header.title].filter(Boolean).join(": "),
      url: url.toString(), publishedAt: new Date(time).toISOString(),
      source: "Dainik Bhaskar", provider: "bhaskar"
    }];
  });
}

const rssItem = z.object({
  title: z.string(), link: z.string().url(), pubDate: z.string(),
  description: z.string().optional()
});

export function parseWorldFeed(xml: string, source: string): NewsItem[] {
  const data = new XMLParser({ parseTagValue: false }).parse(xml);
  const items: unknown = data?.rss?.channel?.item;
  if (!items) throw new Error(`${source} feed has no RSS stories`);
  return (Array.isArray(items) ? items : [items]).flatMap((item): NewsItem[] => {
    const parsed = rssItem.safeParse(item);
    if (!parsed.success) return [];
    const story = parsed.data;
    const time = Date.parse(story.pubDate);
    if (!Number.isFinite(time)) return [];
    return [{
      title: load(story.title).text().trim(), url: story.link,
      publishedAt: new Date(time).toISOString(), source, provider: "world-rss",
      summary: story.description ? load(story.description).text().trim().slice(0, 700) : undefined
    }];
  });
}
