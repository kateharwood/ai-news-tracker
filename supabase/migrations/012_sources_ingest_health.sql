-- Track per-source ingest reachability (starvation) and slow/timeout fetches for Sources UI.

ALTER TABLE public.sources
  ADD COLUMN IF NOT EXISTS last_ingest_attempt_at timestamptz NULL;

ALTER TABLE public.sources
  ADD COLUMN IF NOT EXISTS ingest_long_fetch_timestamps jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.sources.last_ingest_attempt_at IS
  'Set when ingest begins fetching this RSS source. Used to detect starvation (ingest run never reached this feed).';

COMMENT ON COLUMN public.sources.ingest_long_fetch_timestamps IS
  'ISO8601 strings of fetches that took very long or timed out; pruned to rolling 48h in app.';
