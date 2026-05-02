import Parser from "rss-parser";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { isLikelyTimeoutError, isRedditFeedUrl, itemDate, redditFeedUrl } from "@/lib/ingest-helpers";
import type { Source } from "./types";

/** Cap per-feed HTTP time so one slow host cannot burn the whole ingest invocation (Vercel max 300s). */
const RSS_FETCH_TIMEOUT_MS = 22_000;

const parser = new Parser({ timeout: RSS_FETCH_TIMEOUT_MS });
const REDDIT_USER_AGENT = "AI-News-Tracker/1.0";

/** Only keep ingested items whose published date is within this window (RSS). */
const INGEST_RECENT_HOURS = 3;
const INGEST_RECENT_WINDOW_MS = INGEST_RECENT_HOURS * 60 * 60 * 1000;
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
          signal: AbortSignal.timeout(RSS_FETCH_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`Status code ${res.status}`);
        const xml = await res.text();
        return parser.parseString(xml);
      }
      return parser.parseURL(trimmed);
    },
    "RSS"
  );
  const cutoff = new Date(Date.now() - INGEST_RECENT_WINDOW_MS);
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
      " | items_past_" +
      INGEST_RECENT_HOURS +
      "h=" +
      recent.length +
      (all.length > recent.length ? " (skipped " + (all.length - recent.length) + " older or undated)" : "")
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

const INGEST_FAILURE_THRESHOLD = 5;

/** Fetches at or above this duration count as “long” (backing up ingest). */
const LONG_INGEST_FETCH_MS = 16_000;
/** Rolling window for stored long-fetch timestamps and UI counts (48h). */
const INGEST_LONG_FETCH_WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_LONG_FETCH_EVENTS = 48;

async function markIngestAttemptStart(
  supabase: ReturnType<typeof createServiceRoleClient>,
  sourceId: string
): Promise<void> {
  const ts = new Date().toISOString();
  const { error } = await supabase.from("sources").update({ last_ingest_attempt_at: ts }).eq("id", sourceId);
  if (error) {
    console.warn("[ingest] Could not set last_ingest_attempt_at", sourceId, error.message);
  }
}

async function recordLongIngestFetchEvent(
  supabase: ReturnType<typeof createServiceRoleClient>,
  sourceId: string,
  elapsedMs: number,
  err: unknown | null
): Promise<void> {
  const timedOut = err !== null && isLikelyTimeoutError(err);
  const verySlow = elapsedMs >= LONG_INGEST_FETCH_MS;
  if (!timedOut && !verySlow) return;

  const { data, error: selErr } = await supabase
    .from("sources")
    .select("ingest_long_fetch_timestamps")
    .eq("id", sourceId)
    .maybeSingle();
  if (selErr) {
    console.warn("[ingest] Could not read ingest_long_fetch_timestamps", sourceId, selErr.message);
    return;
  }
  const raw = data?.ingest_long_fetch_timestamps;
  const arr = Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];
  const cutoff = Date.now() - INGEST_LONG_FETCH_WINDOW_MS;
  const pruned = arr.filter((t) => {
    const ms = new Date(t).getTime();
    return !Number.isNaN(ms) && ms >= cutoff;
  });
  pruned.push(new Date().toISOString());
  const trimmed = pruned.slice(-MAX_LONG_FETCH_EVENTS);
  const { error: updErr } = await supabase
    .from("sources")
    .update({ ingest_long_fetch_timestamps: trimmed })
    .eq("id", sourceId);
  if (updErr) {
    console.warn("[ingest] Could not update ingest_long_fetch_timestamps", sourceId, updErr.message);
  }
}

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
    return s.type;
  };

  for (const source of sources as Source[]) {
    const config = source.config as { url?: string; category?: string; keyword?: string };
    const label = sourceLabel(source);
    try {
      const fetchedAt = new Date().toISOString();
      if (source.type === "rss" && config.url) {
        const feedUrl = config.url.trim();
        await markIngestAttemptStart(supabase, source.id);
        console.log("[ingest] === RSS feed:", label, "| URL:", feedUrl, "===");
        const t0 = Date.now();
        let items: Awaited<ReturnType<typeof fetchRssFeed>>;
        try {
          items = await fetchRssFeed(feedUrl);
        } catch (fetchErr) {
          const elapsed = Date.now() - t0;
          await recordLongIngestFetchEvent(supabase, source.id, elapsed, fetchErr);
          throw fetchErr;
        }
        const elapsedOk = Date.now() - t0;
        await recordLongIngestFetchEvent(supabase, source.id, elapsedOk, null);
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
      }
    } catch (err) {
      console.error("[ingest] ERROR source", source.id, "(" + label + "):", err);
      await incrementIngestFailureStreak(supabase, source.id);
    }
  }
  console.log("[ingest] Ingest complete: total new raw_fetched_items inserted =", inserted);
  return { inserted };
}
