-- Mark which ranking slot is the "surprise" (random pick, not LLM-ranked)
ALTER TABLE public.daily_rankings
  ADD COLUMN IF NOT EXISTS is_surprise boolean NOT NULL DEFAULT false;
