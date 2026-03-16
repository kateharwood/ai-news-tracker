import Parser from "rss-parser";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { isDuplicate } from "./dedup";
import type { Source } from "./types";

const parser = new Parser();
const REDDIT_USER_AGENT = "AI-News-Tracker/1.0";

function isRedditFeedUrl(url: string): boolean {
  try {
    return new URL(url.trim()).hostname.toLowerCase().includes("reddit.com");
  } catch {
    return false;
  }
}

/** Reddit serves RSS at path ending in .rss; normalize so we hit the feed. */
function redditFeedUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const u = new URL(trimmed);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    if (!path.toLowerCase().endsWith(".rss")) {
      u.pathname = path + ".rss";
    }
    return u.toString();
  } catch {
    return trimmed;
  }
}

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const RSS_RETRY_ATTEMPTS = 3;
const RSS_RETRY_DELAY_MS = 2000;

async function fetchWithRetry<T>(fn: () => Promise<T>, context: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RSS_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const is429 = msg.includes("429") || (err && typeof err === "object" && "statusCode" in err && (err as { statusCode: number }).statusCode === 429);
      const isRetryable = is429 || msg.includes("503") || msg.includes("502");
      if (isRetryable && attempt < RSS_RETRY_ATTEMPTS) {
        const delay = RSS_RETRY_DELAY_MS * attempt;
        console.warn("[ingest]", context, "attempt", attempt, "failed:", msg, "- retrying in", delay, "ms");
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}

function itemDate(item: { pubDate?: string; isoDate?: string }): Date | null {
  const raw = item.isoDate || item.pubDate;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function fetchRssFeed(url: string): Promise<
  { title: string; content: string; link: string; guid: string }[]
> {
  const trimmed = url.trim();
  const isReddit = isRedditFeedUrl(trimmed);
  const feed = await fetchWithRetry(
    async () => {
      if (isReddit) {
        const feedUrl = redditFeedUrl(trimmed);
        const res = await fetch(feedUrl, {
          headers: {
            "User-Agent": REDDIT_USER_AGENT,
            Accept: "application/rss+xml, application/xml, text/xml, */*",
          },
        });
        if (!res.ok) throw new Error(`Status code ${res.status}`);
        const xml = await res.text();
        return parser.parseString(xml);
      }
      return parser.parseURL(trimmed);
    },
    "RSS"
  );
  const cutoff = new Date(Date.now() - TWO_DAYS_MS);
  const all = feed.items || [];
  const recent = all.filter((item) => {
    const d = itemDate(item);
    return d !== null && d >= cutoff;
  });
  if (all.length > recent.length) {
    console.log("[ingest] RSS: kept", recent.length, "items from past 2 days, skipped", all.length - recent.length, "older");
  }
  return recent
    .map((item) => {
      const description =
        item.contentSnippet ||
        (typeof item.summary === "string" ? item.summary : "") ||
        "";
      return {
        title: item.title || "",
        content: description,
        link: item.link || item.guid || "",
        guid: item.guid || item.link || item.title || Math.random().toString(),
      };
    });
}

export async function fetchArxivFeed(
  category: string,
  keyword?: string
): Promise<{ title: string; content: string; link: string; id: string }[]> {
  const query = keyword
    ? `all:${encodeURIComponent(keyword)}`
    : `cat:${category}`;
  const url = `http://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=30`;
  const res = await fetch(url);
  const xml = await res.text();
  const items: { title: string; content: string; link: string; id: string }[] = [];
  const idMatch = xml.matchAll(/<id>http:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/g);
  const ids = Array.from(idMatch).map((m) => m[1]);
  const titleMatch = xml.matchAll(/<title>([\s\S]*?)<\/title>/g);
  const titles = Array.from(titleMatch)
    .filter((_, i) => i > 0)
    .map((m) => m[1].replace(/\s+/g, " ").trim());
  const summaryMatch = xml.matchAll(/<summary>([\s\S]*?)<\/summary>/g);
  const summaries = Array.from(summaryMatch).map((m) =>
    m[1].replace(/\s+/g, " ").trim().replace(/&quot;/g, '"')
  );
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const title = titles[i] ?? "";
    const content = summaries[i] ?? "";
    items.push({
      title,
      content,
      link: `https://arxiv.org/abs/${id}`,
      id,
    });
  }
  return items;
}

export async function ingestAll(): Promise<{ inserted: number }> {
  const supabase = createServiceRoleClient();
  const { data: sources } = await supabase
    .from("sources")
    .select("id, type, config")
    .eq("enabled", true);
  if (!sources?.length) return { inserted: 0 };

  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const { data: existingRaw } = await supabase
    .from("raw_fetched_items")
    .select("url, title")
    .gte("fetched_at", fiveDaysAgo);
  const { data: existingNews } = await supabase
    .from("news_items")
    .select("url, title")
    .gte("included_at", fiveDaysAgo);
  const existing = [
    ...(existingRaw || []),
    ...(existingNews || []).map((n) => ({ url: n.url, title: n.title })),
  ];
  console.log("[ingest] Dedupe: checking against", existingRaw?.length ?? 0, "raw +", existingNews?.length ?? 0, "news items from past 5 days");

  let inserted = 0;
  for (const source of sources as Source[]) {
    const config = source.config as { url?: string; category?: string; keyword?: string };
    try {
      if (source.type === "rss" && config.url) {
        const feedUrl = config.url.trim();
        console.log("[ingest] Starting RSS feed:", feedUrl);
        const items = await fetchRssFeed(feedUrl);
        for (const item of items) {
          if (isDuplicate(item.link, item.title, existing)) continue;
          const { error } = await supabase.from("raw_fetched_items").upsert(
            {
              source_id: source.id,
              external_id: item.guid,
              title: item.title,
              raw_content: item.content,
              url: item.link,
              fetched_at: new Date().toISOString(),
            },
            { onConflict: "source_id,external_id" }
          );
          if (!error) {
            inserted++;
            existing.push({ url: item.link, title: item.title });
          }
        }
      } else if (source.type === "arxiv" && config.category) {
        const items = await fetchArxivFeed(
          config.category,
          config.keyword
        );
        for (const item of items) {
          if (isDuplicate(item.link, item.title, existing)) continue;
          const { error } = await supabase.from("raw_fetched_items").upsert(
            {
              source_id: source.id,
              external_id: item.id,
              title: item.title,
              raw_content: item.content,
              url: item.link,
              fetched_at: new Date().toISOString(),
            },
            { onConflict: "source_id,external_id" }
          );
          if (!error) {
            inserted++;
            existing.push({ url: item.link, title: item.title });
          }
        }
      }
    } catch (err) {
      const detail =
        source.type === "rss" && config.url
          ? ` feed: ${config.url.trim()}`
          : source.type === "arxiv" && config.category
            ? ` arxiv: ${config.category}`
            : "";
      console.error("Ingest error for source", source.id, detail, err);
    }
  }
  return { inserted };
}
