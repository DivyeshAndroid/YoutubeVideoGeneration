import { config } from "./config.js";

export type NewsProvider = "google-rss" | "gdelt" | "hacker-news";

export type NewsItem = {
  title: string;
  url: string;
  publishedAt: string;
  source: string;
  provider: NewsProvider;
};

const decodeXml = (value: string) => value
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">");

async function request(url: string, timeoutMs = 15_000): Promise<Response> {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetch(url, {
      headers: { "user-agent": "YoutubeVideoGeneration/1.0 (+local news aggregation)" },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (response.status !== 429 && response.status < 500) return response;
    if (attempt === 0) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) ? Math.min(5_000, retryAfter * 1_000) : 2_000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return response!;
}

function isoDate(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

async function fetchGoogleNews(): Promise<NewsItem[]> {
  const query = encodeURIComponent(`${config.NEWS_TOPIC} ${config.NEWS_REGION} when:${config.NEWS_LOOKBACK_HOURS}h`);
  const response = await request(`https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`);
  if (!response.ok) throw new Error(`Google News RSS returned HTTP ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => {
    const item = match[1];
    const read = (tag: string) => decodeXml(item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1] ?? "").trim();
    return {
      title: read("title"),
      url: read("link"),
      publishedAt: isoDate(read("pubDate")),
      source: read("source") || "Google News",
      provider: "google-rss" as const
    };
  }).filter((item) => item.title && item.url && item.publishedAt !== "Invalid Date");
}

async function fetchGdelt(): Promise<NewsItem[]> {
  const params = new URLSearchParams({
    query: `${config.NEWS_TOPIC} ${config.NEWS_REGION}`,
    mode: "artlist",
    format: "json",
    sort: "datedesc",
    maxrecords: "75",
    timespan: `${config.NEWS_LOOKBACK_HOURS}h`
  });
  const response = await request(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`);
  if (!response.ok) throw new Error(`GDELT returned HTTP ${response.status}`);
  const data = await response.json() as {
    articles?: Array<{ title?: string; url?: string; seendate?: string; domain?: string }>;
  };
  return (data.articles ?? []).map((article) => ({
    title: article.title?.trim() ?? "",
    url: article.url ?? "",
    publishedAt: parseGdeltDate(article.seendate),
    source: article.domain || hostname(article.url) || "GDELT",
    provider: "gdelt" as const
  })).filter((item) => item.title && item.url && item.publishedAt);
}

function parseGdeltDate(value?: string): string {
  if (!value) return "";
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return isoDate(value);
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
}

type HackerNewsItem = { id: number; type?: string; title?: string; url?: string; time?: number; dead?: boolean; deleted?: boolean };

async function fetchHackerNews(): Promise<NewsItem[]> {
  if (!/(technology|artificial intelligence|\bai\b|software|startup|programming|cyber|science)/i.test(config.NEWS_TOPIC)) return [];
  const response = await request("https://hacker-news.firebaseio.com/v0/newstories.json");
  if (!response.ok) throw new Error(`Hacker News returned HTTP ${response.status}`);
  const ids = (await response.json() as number[]).slice(0, 60);
  const results = await Promise.allSettled(ids.map(async (id) => {
    const itemResponse = await request(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, 8_000);
    if (!itemResponse.ok) throw new Error(`HN item ${id} returned HTTP ${itemResponse.status}`);
    return itemResponse.json() as Promise<HackerNewsItem>;
  }));
  const cutoff = Date.now() - config.NEWS_LOOKBACK_HOURS * 3_600_000;
  return results.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
    .filter((item) => item.type === "story" && !item.dead && !item.deleted && item.title && item.time && item.time * 1_000 >= cutoff)
    .map((item) => ({
      title: item.title!,
      url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
      publishedAt: new Date(item.time! * 1_000).toISOString(),
      source: hostname(item.url) || "Hacker News",
      provider: "hacker-news" as const
    }));
}

function hostname(value?: string): string {
  try { return value ? new URL(value).hostname.replace(/^www\./, "") : ""; }
  catch { return ""; }
}

function normalizedTitle(title: string): string {
  return title.toLowerCase()
    .replace(/\s+[-–—|]\s+[^-–—|]+$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch { return value; }
}

function titleTerms(title: string): Set<string> {
  return new Set(normalizedTitle(title).split(" ").filter((term) => term.length >= 4));
}

function similarity(a: NewsItem, b: NewsItem): number {
  const left = titleTerms(a.title);
  const right = titleTerms(b.title);
  const intersection = [...left].filter((term) => right.has(term)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function rank(item: NewsItem, corroborationCount = 0): number {
  const terms = `${config.NEWS_TOPIC} ${config.NEWS_REGION}`.toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 3 && !["and", "the", "global"].includes(term));
  const title = item.title.toLowerCase();
  const relevance = terms.reduce((score, term) => score + (title.includes(term) ? 3 : 0), 0);
  const ageHours = Math.max(0, (Date.now() - Date.parse(item.publishedAt)) / 3_600_000);
  const freshness = Math.max(0, config.NEWS_LOOKBACK_HOURS - ageHours) / config.NEWS_LOOKBACK_HOURS;
  // Independent publisher coverage is the strongest "hot news" signal;
  // Hacker News remains discovery-only and does not count as corroboration.
  return relevance + freshness * 4 + corroborationCount * 2 + (item.provider === "google-rss" ? 0.2 : 0);
}

/** Fetch, normalize, deduplicate, and rank recent coverage from independent free providers. */
export async function fetchLatestNews(): Promise<NewsItem[]> {
  const enabled = new Set(config.NEWS_PROVIDERS.split(",").map((value) => value.trim()).filter(Boolean));
  const allProviders: Array<[NewsProvider, () => Promise<NewsItem[]>]> = [
    ["google-rss", fetchGoogleNews],
    ["gdelt", fetchGdelt],
    ["hacker-news", fetchHackerNews]
  ];
  const providers = allProviders.filter(([name]) => enabled.has(name));
  if (!providers.length) throw new Error(`NEWS_PROVIDERS does not contain a supported provider: ${config.NEWS_PROVIDERS}`);

  const settled = await Promise.allSettled(providers.map(([, load]) => load()));
  const combined: NewsItem[] = [];
  settled.forEach((result, index) => {
    const name = providers[index][0];
    if (result.status === "fulfilled") {
      console.log(`News provider ${name}: ${result.value.length} recent items`);
      combined.push(...result.value);
    } else {
      console.warn(`News provider ${name} unavailable:`, result.reason);
    }
  });
  if (!combined.length) throw new Error("All enabled news providers failed or returned no recent coverage");

  const corroboration = new Map<NewsItem, number>();
  for (const item of combined) {
    const publishers = new Set(combined
      .filter((candidate) => candidate !== item
        && candidate.provider !== "hacker-news"
        && candidate.source !== item.source
        && similarity(item, candidate) >= 0.45)
      .map((candidate) => candidate.source));
    corroboration.set(item, publishers.size);
  }

  const seenTitles = new Set<string>();
  const seenUrls = new Set<string>();
  return combined
    .sort((a, b) => rank(b, corroboration.get(b)) - rank(a, corroboration.get(a))
      || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .filter((item) => {
      const title = normalizedTitle(item.title);
      const url = canonicalUrl(item.url);
      if (!title || seenTitles.has(title) || seenUrls.has(url)) return false;
      seenTitles.add(title);
      seenUrls.add(url);
      item.url = url;
      return true;
    })
    .slice(0, config.NEWS_MAX_ITEMS);
}
