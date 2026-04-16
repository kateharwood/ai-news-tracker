import { createServiceRoleClient } from "@/lib/supabase/service";
import { rolling24HoursAgo, todayEastern } from "./time";
import {
  buildFilterItemPrompt,
  buildRankTop12Prompt,
  filterItem,
  summarizeItem,
  rankTop12,
} from "./claude";
import { ingestAll } from "./ingest";
import { isDuplicate } from "./dedup";

const PREFERENCE_PROMPT_ID = "00000000-0000-0000-0000-000000000001";

/** Raw rows older than this (by `fetched_at`) with `filtered_at` still null are marked skipped, not LLM-filtered. */
const STALE_UNFILTERED_RAW_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

const MAX_DIGEST_SLOTS = 10;
const MAX_PER_SOURCE = 2;
const LLM_RANK_DEPTH = 12;

type RankableNews = {
  id: string;
  title: string;
  summary: string | null;
  url: string | null;
  raw_fetched_items:
    | { source_id?: string; sources?: { type?: string } | { type?: string }[] | null }
    | { source_id?: string; sources?: { type?: string } | { type?: string }[] | null }[]
    | null;
};

type FinalRankRow = { news_item_id: string; rank: number; is_surprise: boolean };

function newsSourceKey(item: RankableNews): string {
  const raw = item.raw_fetched_items ?? null;
  const row = Array.isArray(raw) ? raw[0] : raw;
  const sid = row && typeof row === "object" && "source_id" in row ? row.source_id : null;
  if (typeof sid === "string" && sid.length > 0) return `source:${sid}`;
  return `item:${item.id}`;
}

function sourceKeyForNewsId(items: RankableNews[], id: string): string {
  const it = items.find((i) => i.id === id);
  return it ? newsSourceKey(it) : `item:${id}`;
}

function uniqueIdsInRankOrder(ranking: { news_item_id: string; rank: number }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of ranking) {
    if (seen.has(r.news_item_id)) continue;
    seen.add(r.news_item_id);
    out.push(r.news_item_id);
  }
  return out;
}

function countBySourceKey(rows: FinalRankRow[], sourceKey: (id: string) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const row of rows) {
    const k = sourceKey(row.news_item_id);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** Build up to MAX_DIGEST_SLOTS rows: start from LLM top 9 + surprise (or 10th from model), enforce ≤2 per source, backfill from ranks 10–12 then pool; may return fewer than MAX_DIGEST_SLOTS. */
function buildDiverseTopRanking(
  items: RankableNews[],
  ranking: { news_item_id: string; rank: number }[]
): FinalRankRow[] {
  const idToItem = new Map(items.map((i) => [i.id, i]));
  const sourceKeyById = (id: string) => {
    const it = idToItem.get(id);
    return it ? newsSourceKey(it) : `item:${id}`;
  };

  const modelOrder = uniqueIdsInRankOrder(ranking).slice(0, LLM_RANK_DEPTH);
  const modelSet = new Set(modelOrder);
  const top9 = modelOrder.slice(0, 9);
  const outsideModel = items.filter((i) => !modelSet.has(i.id));
  const surpriseId =
    outsideModel.length > 0
      ? outsideModel[Math.floor(Math.random() * outsideModel.length)].id
      : modelOrder[9] ?? null;

  let rows: FinalRankRow[] = top9.map((news_item_id, i) => ({
    news_item_id,
    rank: i + 1,
    is_surprise: false,
  }));
  if (surpriseId !== null && !rows.some((r) => r.news_item_id === surpriseId)) {
    rows.push({
      news_item_id: surpriseId,
      rank: 10,
      is_surprise: outsideModel.length > 0,
    });
  } else if (rows.length === 9 && modelOrder[9] && !rows.some((r) => r.news_item_id === modelOrder[9])) {
    rows.push({ news_item_id: modelOrder[9], rank: 10, is_surprise: false });
  }

  const renumber = (r: FinalRankRow[]) => r.forEach((row, i) => (row.rank = i + 1));

  const removeOverQuota = (): boolean => {
    const counts = countBySourceKey(rows, (id) => sourceKeyById(id));
    const overKey = Array.from(counts.entries()).find(([, n]) => n > MAX_PER_SOURCE)?.[0];
    if (!overKey) return false;
    const candidates = rows.filter((row) => sourceKeyById(row.news_item_id) === overKey);
    const victim = candidates.reduce((a, b) => (a.rank > b.rank ? a : b));
    rows = rows.filter((row) => row.news_item_id !== victim.news_item_id);
    renumber(rows);
    return true;
  };

  while (removeOverQuota()) {
    /* drain */
  }

  const used = new Set(rows.map((r) => r.news_item_id));
  const replacementQueue: string[] = [];
  for (const id of modelOrder) {
    if (!used.has(id)) replacementQueue.push(id);
  }
  for (const it of items) {
    if (!used.has(it.id) && !replacementQueue.includes(it.id)) replacementQueue.push(it.id);
  }

  const canAdd = (id: string): boolean => {
    const k = sourceKeyById(id);
    const c = countBySourceKey(rows, (nid) => sourceKeyById(nid)).get(k) ?? 0;
    return c < MAX_PER_SOURCE;
  };

  while (rows.length < MAX_DIGEST_SLOTS && replacementQueue.length > 0) {
    const id = replacementQueue.shift()!;
    if (used.has(id) || !canAdd(id)) continue;
    rows.push({ news_item_id: id, rank: rows.length + 1, is_surprise: false });
    used.add(id);
    renumber(rows);
  }

  renumber(rows);
  return rows;
}

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

/** Ingest feeds and run the LLM filter on unprocessed raw items (same as the frequent cron). */
export async function runIngestFilterJob(): Promise<{
  ingested: number;
  filtered: number;
  ranked: 0;
  skipped_stale?: number;
  error?: string;
}> {
  const supabase = createServiceRoleClient();
  const result: {
    ingested: number;
    filtered: number;
    ranked: 0;
    skipped_stale?: number;
    error?: string;
  } = { ingested: 0, filtered: 0, ranked: 0 };

  try {
    console.log("[daily-job] ========== Ingest + filter job ==========");
    const ingestResult = await ingestAll();
    result.ingested = ingestResult.inserted;
    console.log("[daily-job] Ingest phase complete: new raw_fetched_items inserted =", result.ingested);

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
      "[daily-job] Claude calls this run (ingest+filter job): filterItem =",
      total,
      "| summarizeItem =",
      summarizeCalls,
      "(extra calls only for included items with no body text)"
    );
    console.log("[daily-job] ========== Ingest + filter job done:", result, "==========");
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error("[daily-job] Error:", result.error, err);
  }
  return result;
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

/** Full pipeline: ingest + filter, then rank. Used by the dashboard manual trigger. */
export async function runDailyJob(): Promise<{
  ingested: number;
  filtered: number;
  ranked: number;
  skipped_stale?: number;
  error?: string;
}> {
  const first = await runIngestFilterJob();
  if (first.error) {
    return {
      ingested: first.ingested,
      filtered: first.filtered,
      ranked: 0,
      skipped_stale: first.skipped_stale,
      error: first.error,
    };
  }
  const second = await runRankingJob();
  return {
    ingested: first.ingested,
    filtered: first.filtered,
    ranked: second.ranked,
    skipped_stale: first.skipped_stale,
    error: second.error,
  };
}
