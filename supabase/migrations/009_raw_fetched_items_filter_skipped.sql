-- Rows fetched but never LLM-filtered can pile up; mark very old ones as skipped so they leave the filter queue.

ALTER TABLE public.raw_fetched_items
  ADD COLUMN IF NOT EXISTS filter_skipped_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS filter_skip_reason text NULL;

COMMENT ON COLUMN public.raw_fetched_items.filter_skipped_at IS
  'Set when the item is removed from the LLM filter queue without filtered_at (e.g. too old to process).';
COMMENT ON COLUMN public.raw_fetched_items.filter_skip_reason IS
  'Why filter was skipped; e.g. stale_unfiltered for fetched_at older than the app threshold.';

CREATE INDEX IF NOT EXISTS idx_raw_fetched_items_pending_filter
  ON public.raw_fetched_items (fetched_at DESC)
  WHERE filtered_at IS NULL AND filter_skipped_at IS NULL;
