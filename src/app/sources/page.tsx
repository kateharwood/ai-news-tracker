import { createServiceRoleClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { SourcesList } from "./sources-list";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ORANGE_MONTHS = 3;
const PAGE_SIZE = 1000;
type SourceStats = { upvotes: number; downvotes: number; top10Appearances: number };

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

  const sourceStats: Record<string, SourceStats> = {};
  for (const s of sources ?? []) {
    sourceStats[s.id] = { upvotes: 0, downvotes: 0, top10Appearances: 0 };
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
          sourceStats[sourceId] = { upvotes: 0, downvotes: 0, top10Appearances: 0 };
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
        sourceStats[sourceId] = { upvotes: 0, downvotes: 0, top10Appearances: 0 };
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
      </p>
      <SourcesList
        initialSources={sources ?? []}
        initialStaleSourceIds={staleSourceIds}
        initialSourceStats={sourceStats}
      />
    </div>
  );
}
