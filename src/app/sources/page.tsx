import { createServiceRoleClient } from "@/lib/supabase/service";
import { SourcesList } from "./sources-list";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ORANGE_MONTHS = 3;
const PAGE_SIZE = 1000;

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
      <SourcesList initialSources={sources ?? []} initialStaleSourceIds={staleSourceIds} />
    </div>
  );
}
