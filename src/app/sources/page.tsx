import { createServiceRoleClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { SourcesList } from "./sources-list";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ORANGE_MONTHS = 3;
/** Rolling window for filter stats; average is count ÷ this (not “calendar days since first use”). */
const FILTER_STATS_DAYS = 4;
const PAGE_SIZE = 1000;
type SourceStats = {
  upvotes: number;
  downvotes: number;
  top10Appearances: number;
  /** Raw items that got `filtered_at` in the rolling window (one LLM filter each). */
  filteredCountWindow: number;
  /** `filteredCountWindow / filter window days` — recent daily rate, not diluted by older idle periods. */
  avgFilteredPerDay: number;
};

async function fetchSourceIdsWithRecentPublished(
  supabase: ReturnType<typeof createServiceRoleClient>,
  cutoffIso: string
): Promise<Set<string>> {
  const result = new Set<string>();

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data: batch, error } = await supabase
      .from("raw_fetched_items")
      .select("source_id")
      .gte("published_at", cutoffIso)
      .order("published_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.warn("[sources] cutoff query failed:", error.message);
      break;
    }

    if (!batch?.length) break;

    for (const row of batch) {
      if (row.source_id) result.add(row.source_id);
    }
    if (batch.length < PAGE_SIZE) break;
  }

  return result;
}

/** Count `raw_fetched_items` with `filtered_at` in range, grouped by `source_id` (paginated). */
async function fetchFilteredCountsBySourceSince(
  supabase: ReturnType<typeof createServiceRoleClient>,
  sinceIso: string
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data: batch, error } = await supabase
      .from("raw_fetched_items")
      .select("source_id")
      .gte("filtered_at", sinceIso)
      .order("filtered_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.warn("[sources] filtered-at stats query failed:", error.message);
      break;
    }

    if (!batch?.length) break;

    for (const row of batch) {
      if (!row.source_id) continue;
      counts.set(row.source_id, (counts.get(row.source_id) ?? 0) + 1);
    }
    if (batch.length < PAGE_SIZE) break;
  }

  return counts;
}

export default async function SourcesPage() {
  const supabase = createServiceRoleClient();
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  const { data: sources, error: sourcesError } = await supabase
    .from("sources")
    .select("id, type, config, enabled, created_at, ingest_failure_streak")
    .order("created_at", { ascending: false });
  if (sourcesError) {
    console.warn("[sources] failed to load sources:", sourcesError.message);
  }

  const cutoffDate = new Date(Date.now());
  cutoffDate.setMonth(cutoffDate.getMonth() - ORANGE_MONTHS);
  const cutoffIso = cutoffDate.toISOString();

  const sourcesWithRecentPublished = await fetchSourceIdsWithRecentPublished(
    supabase,
    cutoffIso
  );

  const staleSourceIds = (sources ?? [])
    .map((s) => s.id)
    .filter((id) => !sourcesWithRecentPublished.has(id));

  const filterStatsSince = new Date();
  filterStatsSince.setDate(filterStatsSince.getDate() - FILTER_STATS_DAYS);
  const filteredCountsBySource = await fetchFilteredCountsBySourceSince(
    supabase,
    filterStatsSince.toISOString()
  );

  const sourceStats: Record<string, SourceStats> = {};
  for (const s of sources ?? []) {
    const n = filteredCountsBySource.get(s.id) ?? 0;
    sourceStats[s.id] = {
      upvotes: 0,
      downvotes: 0,
      top10Appearances: 0,
      filteredCountWindow: n,
      avgFilteredPerDay: n / FILTER_STATS_DAYS,
    };
  }

  if (user?.id) {
    const { data: voteRows, error: votesError } = await supabase
      .from("votes")
      .select("direction, news_items(raw_fetched_items(source_id))")
      .eq("user_id", user.id);
    if (votesError) {
      console.warn("[sources] failed to load vote stats:", votesError.message);
    } else {
      for (const row of voteRows ?? []) {
        const news = Array.isArray(row.news_items) ? row.news_items[0] : row.news_items;
        const raw = news?.raw_fetched_items;
        const rawItem = Array.isArray(raw) ? raw[0] : raw;
        const sourceId = rawItem?.source_id ?? null;
        if (!sourceId) continue;
        if (!sourceStats[sourceId]) {
          sourceStats[sourceId] = {
            upvotes: 0,
            downvotes: 0,
            top10Appearances: 0,
            filteredCountWindow: 0,
            avgFilteredPerDay: 0,
          };
        }
        if (row.direction === "up") sourceStats[sourceId].upvotes += 1;
        else if (row.direction === "down") sourceStats[sourceId].downvotes += 1;
      }
    }
  }

  const { data: top10Rows, error: top10Error } = await supabase
    .from("daily_rankings")
    .select("news_items(raw_fetched_items(source_id))");
  if (top10Error) {
    console.warn("[sources] failed to load top10 appearance stats:", top10Error.message);
  } else {
    for (const row of top10Rows ?? []) {
      const news = Array.isArray(row.news_items) ? row.news_items[0] : row.news_items;
      const raw = news?.raw_fetched_items;
      const rawItem = Array.isArray(raw) ? raw[0] : raw;
      const sourceId = rawItem?.source_id ?? null;
      if (!sourceId) continue;
      if (!sourceStats[sourceId]) {
        sourceStats[sourceId] = {
          upvotes: 0,
          downvotes: 0,
          top10Appearances: 0,
          filteredCountWindow: 0,
          avgFilteredPerDay: 0,
        };
      }
      sourceStats[sourceId].top10Appearances += 1;
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-zinc-900 mb-2">Sources</h1>
      <p className="text-sm text-zinc-500 mb-6 space-y-2">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-orange-200 border border-orange-400 shrink-0" aria-hidden />
            Orange: no feed items with pubdates in the last 3 months.
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-red-200 border border-red-500 shrink-0" aria-hidden />
            Red: ingest failed 5 runs in a row (e.g. 5 daily fetches with errors — check URL or blocks).
          </span>
        </span>
        <span className="block mt-3 text-zinc-600 max-w-xl">
          Here, <span className="font-medium text-zinc-700">filtered</span> means one LLM include/exclude
          pass per raw item. Usage logs often show more calls: optional summarize when an included item
          has no body text, plus a separate ranking call when that job runs.
        </span>
      </p>
      <SourcesList
        initialSources={sources ?? []}
        initialStaleSourceIds={staleSourceIds}
        initialSourceStats={sourceStats}
        filterWindowDays={FILTER_STATS_DAYS}
      />
    </div>
  );
}
