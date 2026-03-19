-- Store original publication timestamp so we can highlight sources
-- based on "pubdates from the last N months", not ingestion time.
ALTER TABLE public.raw_fetched_items
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- Backfill existing rows: fall back to fetched_at so older data is still usable.
UPDATE public.raw_fetched_items
SET published_at = fetched_at
WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_raw_fetched_items_published_at
  ON public.raw_fetched_items(published_at);

