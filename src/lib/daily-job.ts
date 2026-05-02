import { createServiceRoleClient } from "@/lib/supabase/service";
import { rolling24HoursAgo, todayEastern } from "./time";
import {
  buildFilterItemPrompt,
  buildRankTop12Prompt,
  filterItem,
  summarizeItem,
  rankTop12,
} from "./claude";
import { buildDiverseTopRanking, MAX_DIGEST_SLOTS, type RankableNews } from "./digest-ranking";
import { ingestAll } from "./ingest";
import { isDuplicate } from "./dedup";

const PREFERENCE_PROMPT_ID = "00000000-0000-0000-0000-000000000001";

/** Raw rows older than this (by `fetched_at`) with `filtered_at` still null are marked skipped, not LLM-filtered. */
const STALE_UNFILTERED_RAW_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

function sourceLabel(s: { type?: string; config?: { url?: string; category?: string; keyword?: string } } | null): string {
  if (!s?.type) return "unknown";
  const cfg = s.config ?? {};
  if (s.type === "rss" && cfg.url) {
    try {
      return new URL(cfg.url.trim()).hostname;
    } catch {
      return cfg.url;
    }
  }
  return s.type;
}

async function loadPreferencePrompt(supabase: ReturnType<typeof createServiceRoleClient>): Promise<string> {
  const { data: promptRow } = await supabase
    .from("preference_prompt")
    .select("content")
    .eq("id", PREFERENCE_PROMPT_ID)
    .single();
  return promptRow?.content ?? "";
}

type IngestOnlyResult = {
  ingested: number;
  filtered: 0;
  ranked: 0;
  skipped_stale?: undefined;
  error?: string;
};

/** RSS ingest only (no LLM). Scheduled as `/api/cron/ingest`. */
export async function runIngestOnlyJob(): Promise<IngestOnlyResult> {
  const result: IngestOnlyResult = { ingested: 0, filtered: 0, ranked: 0 };
  try {
    console.log("[daily-job] ========== Ingest-only job ==========");
    const ingestResult = await ingestAll();
    result.ingested = ingestResult.inserted;
    console.log("[daily-job] Ingest-only complete: new raw_fetched_items inserted =", result.ingested);
    console.log("[daily-job] ========== Ingest-only job done:", result, "==========");
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error("[daily-job] Error:", result.error, err);
  }
  return result;
}

type FilterOnlyResult = {
  ingested: 0;
  filtered: number;
  ranked: 0;
  skipped_stale?: number;
  error?: string;
};

/** LLM filter on pending raw rows (no ingest). Scheduled as `/api/cron/filter`. */
export async function runFilterOnlyJob(): Promise<FilterOnlyResult> {
  const supabase = createServiceRoleClient();
  const result: FilterOnlyResult = { ingested: 0, filtered: 0, ranked: 0 };

  try {
    console.log("[daily-job] ========== Filter-only job ==========");
    const preferencePrompt = await loadPreferencePrompt(supabase);

    const staleCutoffIso = new Date(Date.now() - STALE_UNFILTERED_RAW_MAX_AGE_MS).toISOString();
    const { count: staleToSkip } = await supabase
      .from("raw_fetched_items")
      .select("*", { count: "exact", head: true })
      .is("filtered_at", null)
      .is("filter_skipped_at", null)
      .lt("fetched_at", staleCutoffIso);

    const skipStamp = new Date().toISOString();
    const { error: staleSkipErr } = await supabase
      .from("raw_fetched_items")
      .update({
        filter_skipped_at: skipStamp,
        filter_skip_reason: "stale_unfiltered",
      })
      .is("filtered_at", null)
      .is("filter_skipped_at", null)
      .lt("fetched_at", staleCutoffIso);
    if (staleSkipErr) {
      throw new Error(`Stale raw skip update failed: ${staleSkipErr.message}`);
    }
    result.skipped_stale = staleToSkip ?? 0;
    if (result.skipped_stale > 0) {
      console.log(
        "[daily-job] Marked",
        result.skipped_stale,
        "raw_fetched_items as filter_skipped (fetched_at <",
        staleCutoffIso,
        ", reason stale_unfiltered) — not sent to LLM"
      );
    }

    const { data: rawItems } = await supabase
      .from("raw_fetched_items")
      .select("id, title, raw_content, url, source_id, sources(type, config)")
      .is("filtered_at", null)
      .is("filter_skipped_at", null)
      .order("fetched_at", { ascending: false });
    const { data: existingNewsRows } = await supabase
      .from("news_items")
      .select("raw_fetched_item_id, url, title");
    const existingStories = (existingNewsRows || []).map((r) => ({ url: r.url, title: r.title }));

    const toProcess: NonNullable<typeof rawItems> = [];
    const seenStories: { url: string | null; title: string }[] = [...existingStories];
    for (const raw of rawItems || []) {
      if (isDuplicate(raw.url ?? null, raw.title, seenStories)) continue;
      toProcess.push(raw);
      seenStories.push({ url: raw.url ?? null, title: raw.title });
    }
    console.log("[daily-job] === Filter phase: LLM include/exclude for each raw item ===");
    console.log(
      "[daily-job] Filter input: pending raw (filtered_at and filter_skipped_at null, fetched in last 2d):",
      rawItems?.length ?? 0,
      "| after URL/title dedupe:",
      toProcess.length,
      "items to process"
    );

    const total = toProcess.length;
    let summarizeCalls = 0;
    for (let i = 0; i < total; i++) {
      const raw = toProcess[i];
      const src = raw && "sources" in raw ? (Array.isArray((raw as { sources: unknown }).sources) ? (raw as { sources: unknown[] }).sources[0] : (raw as { sources: unknown }).sources) : null;
      const label = sourceLabel(src as Parameters<typeof sourceLabel>[0]);
      const titleSnip = raw.title?.slice(0, 50) + (raw.title && raw.title.length > 50 ? "…" : "");
      console.log("[daily-job] Filter item", i + 1, "of", total, "| source:", label, "| title:", titleSnip);
      if (i === 0) {
        const fullPrompt = buildFilterItemPrompt(
          preferencePrompt,
          raw.title,
          raw.raw_content ?? "",
          raw.url ?? ""
        );
        console.log("[daily-job] Filter prompt (first item only, exact user message):\n" + fullPrompt);
      }
      const decision = await filterItem(
        preferencePrompt,
        raw.title,
        raw.raw_content ?? "",
        raw.url ?? ""
      );
      const now = new Date().toISOString();
      await supabase
        .from("raw_fetched_items")
        .update({ filtered_at: now })
        .eq("id", raw.id);
      if (decision !== "INCLUDED") continue;
      let summary: string | null =
        (raw.raw_content && raw.raw_content.trim().length > 0)
          ? raw.raw_content.slice(0, 200).trim()
          : null;
      if (!summary) {
        summarizeCalls++;
        summary = await summarizeItem(raw.title, raw.raw_content ?? "");
      }
      const { data: inserted } = await supabase
        .from("news_items")
        .insert({
          raw_fetched_item_id: raw.id,
          title: raw.title,
          summary,
          url: raw.url,
          included_at: now,
        })
        .select("id")
        .single();
      if (inserted) {
        result.filtered++;
      }
    }
    console.log("[daily-job] Filter phase complete: items included (→ news_items) =", result.filtered);
    console.log(
      "[daily-job] Claude calls this run (filter-only job): filterItem =",
      total,
      "| summarizeItem =",
      summarizeCalls,
      "(extra calls only for included items with no body text)"
    );
    console.log("[daily-job] ========== Filter-only job done:", result, "==========");
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error("[daily-job] Error:", result.error, err);
  }
  return result;
}

/** Ingest then filter in one process (legacy / manual curl). Prefer split crons on Vercel. */
export async function runIngestFilterJob(): Promise<{
  ingested: number;
  filtered: number;
  ranked: 0;
  skipped_stale?: number;
  error?: string;
}> {
  const ingest = await runIngestOnlyJob();
  if (ingest.error) {
    return {
      ingested: ingest.ingested,
      filtered: 0,
      ranked: 0,
      error: ingest.error,
    };
  }
  const filter = await runFilterOnlyJob();
  return {
    ingested: ingest.ingested,
    filtered: filter.filtered,
    ranked: 0,
    skipped_stale: filter.skipped_stale,
    error: filter.error,
  };
}

/** Rank top stories from candidates included in the rolling last 24 hours (`included_at`). Runs once per day on a schedule. */
export async function runRankingJob(): Promise<{
  ingested: 0;
  filtered: 0;
  ranked: number;
  error?: string;
}> {
  const supabase = createServiceRoleClient();
  const result: {
    ingested: 0;
    filtered: 0;
    ranked: number;
    error?: string;
  } = { ingested: 0, filtered: 0, ranked: 0 };

  try {
    console.log("[daily-job] ========== Ranking job (rolling 24h included → daily_rankings) ==========");
    const preferencePrompt = await loadPreferencePrompt(supabase);

    const start = rolling24HoursAgo();
    const startIso = start.toISOString();
    const { data: recentNews } = await supabase
      .from("news_items")
      .select("id, title, summary, url, raw_fetched_items(source_id, sources(type))")
      .gte("included_at", startIso)
      .order("included_at", { ascending: false });
    const items = (recentNews || []) as RankableNews[];
    console.log(
      "[daily-job] === Rank phase: LLM ranks top 12 → trim to ≤10, max 2 per source ==="
    );
    console.log(
      "[daily-job] Rank window: included_at >=",
      startIso,
      "(now − 24h) | candidates (news_items) =",
      items.length
    );
    if (items.length > 0) {
      const rankPrompt = buildRankTop12Prompt(preferencePrompt, items);
      console.log("[daily-job] Rank prompt (exact user message):\n" + rankPrompt);
      const ranking = await rankTop12(preferencePrompt, items);
      const final = buildDiverseTopRanking(items, ranking);

      final.forEach((row, i) => {
        row.rank = i + 1;
      });
      const today = todayEastern();
      await supabase.from("daily_rankings").delete().eq("date", today);
      for (const r of final) {
        await supabase.from("daily_rankings").insert({
          news_item_id: r.news_item_id,
          rank: r.rank,
          date: today,
          is_surprise: r.is_surprise,
        });
        result.ranked++;
      }
      console.log(
        "[daily-job] Rank phase complete: wrote",
        result.ranked,
        "rows to daily_rankings for date",
        today,
        "(max",
        MAX_DIGEST_SLOTS,
        "slots; may be fewer if source diversity + pool cannot fill)"
      );
    } else {
      console.log("[daily-job] Rank phase skipped: no news_items in last 24h");
    }
    console.log("[daily-job] ========== Ranking job done:", result, "==========");
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error("[daily-job] Error:", result.error, err);
  }
  return result;
}

/**
 * Full pipeline in one process: ingest → filter → rank.
 * On Vercel (300s cap) this often times out; the dashboard uses three `POST /api/run/*` calls instead.
 */
export async function runDailyJob(): Promise<{
  ingested: number;
  filtered: number;
  ranked: number;
  skipped_stale?: number;
  error?: string;
}> {
  const ingest = await runIngestOnlyJob();
  if (ingest.error) {
    return {
      ingested: ingest.ingested,
      filtered: 0,
      ranked: 0,
      error: ingest.error,
    };
  }
  const filter = await runFilterOnlyJob();
  if (filter.error) {
    return {
      ingested: ingest.ingested,
      filtered: filter.filtered,
      ranked: 0,
      skipped_stale: filter.skipped_stale,
      error: filter.error,
    };
  }
  const rank = await runRankingJob();
  return {
    ingested: ingest.ingested,
    filtered: filter.filtered,
    ranked: rank.ranked,
    skipped_stale: filter.skipped_stale,
    error: rank.error,
  };
}
