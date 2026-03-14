import { createServiceRoleClient } from "@/lib/supabase/service";
import { last24hStart, todayEastern } from "./time";
import {
  filterItem,
  summarizeItem,
  rankTop10,
  wordCount,
} from "./claude";
import { ingestAll } from "./ingest";
import { isDuplicate } from "./dedup";

const PREFERENCE_PROMPT_ID = "00000000-0000-0000-0000-000000000001";

export async function runDailyJob(): Promise<{
  ingested: number;
  filtered: number;
  ranked: number;
  error?: string;
}> {
  const supabase = createServiceRoleClient();
  const result: {
    ingested: number;
    filtered: number;
    ranked: number;
    error?: string;
  } = { ingested: 0, filtered: 0, ranked: 0 };

  try {
    console.log("[daily-job] Starting: ingest → filter → rank");
    const ingestResult = await ingestAll();
    result.ingested = ingestResult.inserted;
    console.log("[daily-job] Ingest done: inserted", result.ingested, "new raw items");

    const { data: promptRow } = await supabase
      .from("preference_prompt")
      .select("content")
      .eq("id", PREFERENCE_PROMPT_ID)
      .single();
    const preferencePrompt = promptRow?.content ?? "";

    const { data: rawItems } = await supabase
      .from("raw_fetched_items")
      .select("id, title, raw_content, url")
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
    console.log("[daily-job] Filter: unfiltered", rawItems?.length ?? 0, "→ after URL/title dedupe", toProcess.length, "to process");

    for (const raw of toProcess) {
      console.log("[daily-job] Filter item:", raw.title?.slice(0, 50) + (raw.title && raw.title.length > 50 ? "…" : ""));
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
    console.log("[daily-job] Filter done: included", result.filtered, "items");

    const start = last24hStart();
    const startIso = start.toISOString();
    const { data: recentNews } = await supabase
      .from("news_items")
      .select("id, title, summary, url")
      .gte("included_at", startIso)
      .order("included_at", { ascending: false });
    const items = recentNews || [];
    console.log("[daily-job] Rank: candidates in last 24h:", items.length);
    if (items.length > 0) {
      const ranking = await rankTop10(preferencePrompt, items);
      const today = todayEastern();
      await supabase.from("daily_rankings").delete().eq("date", today);
      for (const r of ranking) {
        await supabase.from("daily_rankings").insert({
          news_item_id: r.news_item_id,
          rank: r.rank,
          date: today,
        });
        result.ranked++;
      }
      console.log("[daily-job] Rank done: wrote", result.ranked, "to daily_rankings for", today);
    } else {
      console.log("[daily-job] Rank skipped: no items in last 24h");
    }
    console.log("[daily-job] Done:", result);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error("[daily-job] Error:", result.error, err);
  }
  return result;
}
