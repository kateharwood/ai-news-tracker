import { createServiceRoleClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { SourcesList } from "./sources-list";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ORANGE_MONTHS = 3;
const PAGE_SIZE = 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Floor for “days since added” so brand-new feeds do not get an infinite filters/day rate. */
const MIN_SOURCE_AGE_DAYS = 1;

type SourceStats = {
  upvotes: number;
  downvotes: number;
  top10Appearances: number;
  /** Raw items that have ever been LLM-filtered (`filtered_at` set), per source. */
  filteredCountAllTime: number;
  /** `filteredCountAllTime` ÷ max(1 day, fractional days since `sources.created_at`). */
  avgFilteredPerDay: number;
};

function avgFilteredPerDaySinceCreated(
  filteredCountAllTime: number,
  sourceCreatedAtIso: string | undefined,
  nowMs: number
): number {
  if (filteredCountAllTime <= 0) return 0;
  const ageDays = sourceCreatedAtIso
    ? Math.max((nowMs - new Date(sourceCreatedAtIso).getTime()) / MS_PER_DAY, MIN_SOURCE_AGE_DAYS)
    : MIN_SOURCE_AGE_DAYS;
  return filteredCountAllTime / ageDays;
}

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

/**
 * Exact all-time filtered counts per source (DB aggregate).
 * Client-side pagination on `raw_fetched_items` was wrong: many rows share the same `filtered_at`
 * (same cron run), so OFFSET/limit ordering is unstable and can undercount.
 */
async function fetchFilteredCountsBySourceAllTime(
  supabase: ReturnType<typeof createServiceRoleClient>
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const { data, error } = await supabase.from("source_filtered_counts").select("source_id, filtered_count");
  if (error) {
    console.warn("[sources] source_filtered_counts query failed:", error.message);
    return counts;
  }
  for (const row of data ?? []) {
    if (row.source_id == null) continue;
    counts.set(row.source_id, Number(row.filtered_count) || 0);
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

  const filteredCountsBySource = await fetchFilteredCountsBySourceAllTime(supabase);
  const nowMs = Date.now();

  const sourceStats: Record<string, SourceStats> = {};
  for (const s of sources ?? []) {
    const n = filteredCountsBySource.get(s.id) ?? 0;
    sourceStats[s.id] = {
      upvotes: 0,
      downvotes: 0,
      top10Appearances: 0,
      filteredCountAllTime: n,
      avgFilteredPerDay: avgFilteredPerDaySinceCreated(n, s.created_at, nowMs),
    };
  }

  const createdAtBySourceId = new Map((sources ?? []).map((s) => [s.id, s.created_at]));

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
          const n = filteredCountsBySource.get(sourceId) ?? 0;
          sourceStats[sourceId] = {
            upvotes: 0,
            downvotes: 0,
            top10Appearances: 0,
            filteredCountAllTime: n,
            avgFilteredPerDay: avgFilteredPerDaySinceCreated(
              n,
              createdAtBySourceId.get(sourceId),
              nowMs
            ),
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
        const n = filteredCountsBySource.get(sourceId) ?? 0;
        sourceStats[sourceId] = {
          upvotes: 0,
          downvotes: 0,
          top10Appearances: 0,
          filteredCountAllTime: n,
          avgFilteredPerDay: avgFilteredPerDaySinceCreated(
            n,
            createdAtBySourceId.get(sourceId),
            nowMs
          ),
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
      />
    </div>
  );
}
