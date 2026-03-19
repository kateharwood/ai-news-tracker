-- Track consecutive failed ingest runs per source (e.g. 5 daily failures = 5 days of errors)
ALTER TABLE public.sources
  ADD COLUMN IF NOT EXISTS ingest_failure_streak integer NOT NULL DEFAULT 0;
