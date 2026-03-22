import { createServiceRoleClient } from "@/lib/supabase/service";
import { last24hStart, todayEastern } from "./time";
import {
  filterItem,
  summarizeItem,
  rankTop10,
} from "./claude";
import { ingestAll } from "./ingest";
import { isDuplicate } from "./dedup";

const PREFERENCE_PROMPT_ID = "00000000-0000-0000-0000-000000000001";

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
  if (s.type === "arxiv") return [cfg.category, cfg.keyword].filter(Boolean).join(" + ") || "arxiv";
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
  error?: string;
}> {
  const supabase = createServiceRoleClient();
  const result: {
    ingested: number;
    filtered: number;
    ranked: 0;
    error?: string;
  } = { ingested: 0, filtered: 0, ranked: 0 };

  try {
    console.log("[daily-job] ========== Ingest + filter job ==========");
    const ingestResult = await ingestAll();
    result.ingested = ingestResult.inserted;
    console.log("[daily-job] Ingest phase complete: new raw_fetched_items inserted =", result.ingested);

    const preferencePrompt = await loadPreferencePrompt(supabase);

    const { data: rawItems } = await supabase
      .from("raw_fetched_items")
      .select("id, title, raw_content, url, source_id, sources(type, config)")
      .is("filtered_at", null)
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
    console.log("[daily-job] Filter input: raw items with filtered_at=null:", rawItems?.length ?? 0, "| after URL/title dedupe:", toProcess.length, "items to process");

    const total = toProcess.length;
    for (let i = 0; i < total; i++) {
      const raw = toProcess[i];
      const src = raw && "sources" in raw ? (Array.isArray((raw as { sources: unknown }).sources) ? (raw as { sources: unknown[] }).sources[0] : (raw as { sources: unknown }).sources) : null;
      const label = sourceLabel(src as Parameters<typeof sourceLabel>[0]);
      const titleSnip = raw.title?.slice(0, 50) + (raw.title && raw.title.length > 50 ? "…" : "");
      console.log("[daily-job] Filter item", i + 1, "of", total, "| source:", label, "| title:", titleSnip);
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
    console.log("[daily-job] ========== Ingest + filter job done:", result, "==========");
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error("[daily-job] Error:", result.error, err);
  }
  return result;
}

/** Rank top stories from candidates in the same window as before (`last24hStart` … now). Runs once per day on a schedule. */
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
    console.log("[daily-job] ========== Ranking job (last-window candidates → daily_rankings) ==========");
    const preferencePrompt = await loadPreferencePrompt(supabase);

    const start = last24hStart();
    const startIso = start.toISOString();
    const { data: recentNews } = await supabase
      .from("news_items")
      .select("id, title, summary, url")
      .gte("included_at", startIso)
      .order("included_at", { ascending: false });
    const items = recentNews || [];
    console.log("[daily-job] === Rank phase: pick top 10 (+ 1 surprise) from news in last 24h ===");
    console.log("[daily-job] Rank input: candidates (news_items in last 24h) =", items.length);
    if (items.length > 0) {
      const ranking = await rankTop10(preferencePrompt, items);
      const rankedIds = new Set(ranking.map((r) => r.news_item_id));
      const surprisePool = items.filter((i) => !rankedIds.has(i.id));
      const top9 = ranking.slice(0, 9);
      const hasSurprise = surprisePool.length > 0;
      const surpriseId = hasSurprise
        ? surprisePool[Math.floor(Math.random() * surprisePool.length)].id
        : null;
      const final =
        hasSurprise && surpriseId
          ? [
              ...top9.map((r, i) => ({ news_item_id: r.news_item_id, rank: i + 1, is_surprise: false })),
              { news_item_id: surpriseId, rank: 10, is_surprise: true },
            ]
          : ranking.map((r) => ({ ...r, is_surprise: false }));
      const today = todayEastern();
      await supabase.from("daily_rankings").delete().eq("date", today);
      for (const r of final) {
        await supabase.from("daily_rankings").insert({
          news_item_id: r.news_item_id,
          rank: r.rank,
          date: today,
          is_surprise: "is_surprise" in r ? r.is_surprise : false,
        });
        result.ranked++;
      }
      console.log(
        "[daily-job] Rank phase complete: wrote",
        result.ranked,
        "rows to daily_rankings for date",
        today,
        surprisePool.length > 0 ? "(includes 1 random surprise slot)" : ""
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
  error?: string;
}> {
  const first = await runIngestFilterJob();
  if (first.error) {
    return {
      ingested: first.ingested,
      filtered: first.filtered,
      ranked: 0,
      error: first.error,
    };
  }
  const second = await runRankingJob();
  return {
    ingested: first.ingested,
    filtered: first.filtered,
    ranked: second.ranked,
    error: second.error,
  };
}
