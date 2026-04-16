-- Exact per-source counts of LLM-filtered raw rows (one row per filter pass).
-- Avoids client-side pagination bugs when many rows share the same `filtered_at`.

CREATE OR REPLACE VIEW public.source_filtered_counts AS
SELECT
  source_id,
  COUNT(*)::bigint AS filtered_count
FROM public.raw_fetched_items
WHERE filtered_at IS NOT NULL
GROUP BY source_id;

COMMENT ON VIEW public.source_filtered_counts IS
  'Per RSS source: number of raw_fetched_items rows that have been through the filter (filtered_at set).';

GRANT SELECT ON public.source_filtered_counts TO service_role;
