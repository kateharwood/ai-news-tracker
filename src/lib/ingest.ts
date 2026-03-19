import Parser from "rss-parser";
import { createServiceRoleClient } from "@/lib/supabase/service";
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
        console.warn("[ingest] RSS fetch retry:", context, "— attempt", attempt, "of", RSS_RETRY_ATTEMPTS, "failed:", msg, "→ retrying in", delay, "ms");
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
  {
    title: string;
    content: string;
    link: string;
    guid: string;
    published_at: string;
  }[]
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
  const recent = all
    .map((item) => {
      const d = itemDate(item);
      return d && d >= cutoff ? { item, d } : null;
    })
    .filter((x): x is { item: (typeof all)[number]; d: Date } => x !== null);

  console.log(
    "[ingest] RSS feed fetch success: URL=" +
      trimmed +
      " | items_in_feed=" +
      all.length +
      " | items_past_2_days=" +
      recent.length +
      (all.length > recent.length ? " (skipped " + (all.length - recent.length) + " older)" : "")
  );

  return recent.map(({ item, d }) => {
    const description =
      item.contentSnippet ||
      (typeof item.summary === "string" ? item.summary : "") ||
      "";
    return {
      title: item.title || "",
      content: description,
      link: item.link || item.guid || "",
      guid: item.guid || item.link || item.title || Math.random().toString(),
      published_at: d.toISOString(),
    };
  });
}

export async function fetchArxivFeed(
  category: string,
  keyword?: string
): Promise<
  {
    title: string;
    content: string;
    link: string;
    id: string;
    published_at: string | null;
  }[]
> {
  const query = keyword
    ? `all:${encodeURIComponent(keyword)}`
    : `cat:${category}`;
  const url = `http://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=30`;
  const res = await fetch(url);
  const xml = await res.text();
  const items: { title: string; content: string; link: string; id: string; published_at: string | null }[] = [];
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
  const publishedMatch = xml.matchAll(/<published>([\s\S]*?)<\/published>/g);
  const publishedDates = Array.from(publishedMatch).map((m) =>
    m[1].replace(/\s+/g, " ").trim()
  );
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const title = titles[i] ?? "";
    const content = summaries[i] ?? "";
    const publishedRaw = publishedDates[i] ?? "";
    const published = publishedRaw ? new Date(publishedRaw) : null;
    items.push({
      title,
      content,
      link: `https://arxiv.org/abs/${id}`,
      id,
      published_at:
        published && !Number.isNaN(published.getTime()) ? published.toISOString() : null,
    });
  }
  return items;
}

const INGEST_FAILURE_THRESHOLD = 5;

async function resetIngestFailureStreak(
  supabase: ReturnType<typeof createServiceRoleClient>,
  sourceId: string
): Promise<void> {
  const { error } = await supabase.from("sources").update({ ingest_failure_streak: 0 }).eq("id", sourceId);
  if (error) {
    console.warn("[ingest] Could not reset ingest_failure_streak (run migration 004?)", sourceId, error.message);
  }
}

async function incrementIngestFailureStreak(
  supabase: ReturnType<typeof createServiceRoleClient>,
  sourceId: string
): Promise<void> {
  const { data: row, error: selErr } = await supabase
    .from("sources")
    .select("ingest_failure_streak")
    .eq("id", sourceId)
    .maybeSingle();
  if (selErr) {
    console.warn("[ingest] Could not read ingest_failure_streak (run migration 004?)", sourceId, selErr.message);
    return;
  }
  const prev = typeof row?.ingest_failure_streak === "number" ? row.ingest_failure_streak : 0;
  const next = prev + 1;
  const { error: updErr } = await supabase.from("sources").update({ ingest_failure_streak: next }).eq("id", sourceId);
  if (updErr) {
    console.warn("[ingest] Could not increment ingest_failure_streak", sourceId, updErr.message);
    return;
  }
  if (next >= INGEST_FAILURE_THRESHOLD) {
    console.warn(
      "[ingest] Source",
      sourceId,
      "ingest_failure_streak =",
      next,
      "(≥",
      INGEST_FAILURE_THRESHOLD,
      "consecutive failures — highlighted red on Sources page)"
    );
  }
}

export async function ingestAll(): Promise<{ inserted: number }> {
  const supabase = createServiceRoleClient();
  const { data: sources } = await supabase
    .from("sources")
    .select("id, type, config")
    .eq("enabled", true);
  if (!sources?.length) return { inserted: 0 };

  let inserted = 0;
  const sourceLabel = (s: Source) => {
    const c = s.config as { url?: string; category?: string; keyword?: string };
    if (s.type === "rss" && c.url) {
      try {
        return new URL(c.url.trim()).hostname;
      } catch {
        return c.url ?? "rss";
      }
    }
    if (s.type === "arxiv" && c.category) return "arxiv " + (c.category ?? "") + (c.keyword ? " " + c.keyword : "");
    return s.type;
  };

  for (const source of sources as Source[]) {
    const config = source.config as { url?: string; category?: string; keyword?: string };
    const label = sourceLabel(source);
    try {
      const fetchedAt = new Date().toISOString();
      if (source.type === "rss" && config.url) {
        const feedUrl = config.url.trim();
        console.log("[ingest] === RSS feed:", label, "| URL:", feedUrl, "===");
        const items = await fetchRssFeed(feedUrl);
        let newFromFeed = 0;
        for (const item of items) {
          const { error } = await supabase.from("raw_fetched_items").upsert(
            {
              source_id: source.id,
              external_id: item.guid,
              title: item.title,
              raw_content: item.content,
              url: item.link,
              published_at: item.published_at,
              fetched_at: fetchedAt,
            },
            { onConflict: "source_id,external_id" }
          );
          if (!error) {
            inserted++;
            newFromFeed++;
          }
        }
        console.log("[ingest] RSS feed result:", label, "| items_from_feed=" + items.length + " | new_saved=" + newFromFeed + " | total_new_so_far=" + inserted);
        await resetIngestFailureStreak(supabase, source.id);
      } else if (source.type === "arxiv" && config.category) {
        console.log("[ingest] === arXiv:", label, "| category:", config.category, config.keyword ? "| keyword: " + config.keyword : "", "===");
        const items = await fetchArxivFeed(
          config.category,
          config.keyword
        );
        let newFromArxiv = 0;
        for (const item of items) {
          const { error } = await supabase.from("raw_fetched_items").upsert(
            {
              source_id: source.id,
              external_id: item.id,
              title: item.title,
              raw_content: item.content,
              url: item.link,
              published_at: item.published_at ?? fetchedAt,
              fetched_at: fetchedAt,
            },
            { onConflict: "source_id,external_id" }
          );
          if (!error) {
            inserted++;
            newFromArxiv++;
          }
        }
        console.log("[ingest] arXiv result:", label, "| items_from_api=" + items.length + " | new_saved=" + newFromArxiv + " | total_new_so_far=" + inserted);
        await resetIngestFailureStreak(supabase, source.id);
      }
    } catch (err) {
      console.error("[ingest] ERROR source", source.id, "(" + label + "):", err);
      await incrementIngestFailureStreak(supabase, source.id);
    }
  }
  console.log("[ingest] Ingest complete: total new raw_fetched_items inserted =", inserted);
  return { inserted };
}
