-- Mark when a raw item has been through the filter (include or exclude) so we don't re-filter it.
ALTER TABLE public.raw_fetched_items
  ADD COLUMN IF NOT EXISTS filtered_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_raw_fetched_items_filtered_at
  ON public.raw_fetched_items(filtered_at);

-- Backfill: raw items that already have a news_item → filtered_at = included_at.
UPDATE public.raw_fetched_items r
SET filtered_at = (SELECT n.included_at FROM public.news_items n WHERE n.raw_fetched_item_id = r.id LIMIT 1)
WHERE r.filtered_at IS NULL
  AND EXISTS (SELECT 1 FROM public.news_items n WHERE n.raw_fetched_item_id = r.id);

-- Raw items with no news_item were previously filtered and excluded → mark as filtered so we don't re-run.
UPDATE public.raw_fetched_items
SET filtered_at = fetched_at
WHERE filtered_at IS NULL;
