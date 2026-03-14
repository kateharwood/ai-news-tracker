-- AI News Tracker – initial schema
-- Run in Supabase SQL editor or via supabase db push

-- 1. sources
CREATE TABLE IF NOT EXISTS public.sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('rss', 'arxiv')),
  config jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. raw_fetched_items
CREATE TABLE IF NOT EXISTS public.raw_fetched_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  title text NOT NULL,
  raw_content text,
  url text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_fetched_items_source_id ON public.raw_fetched_items(source_id);
CREATE INDEX IF NOT EXISTS idx_raw_fetched_items_url ON public.raw_fetched_items(url);

-- 3. news_items
CREATE TABLE IF NOT EXISTS public.news_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_fetched_item_id uuid NOT NULL REFERENCES public.raw_fetched_items(id) ON DELETE CASCADE,
  title text NOT NULL,
  summary text,
  url text,
  included_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_news_items_included_at ON public.news_items(included_at);
CREATE INDEX IF NOT EXISTS idx_news_items_raw_fetched_item_id ON public.news_items(raw_fetched_item_id);

-- 4. daily_rankings
CREATE TABLE IF NOT EXISTS public.daily_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  news_item_id uuid NOT NULL REFERENCES public.news_items(id) ON DELETE CASCADE,
  rank smallint NOT NULL CHECK (rank >= 1 AND rank <= 10),
  date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(date, rank)
);

CREATE INDEX IF NOT EXISTS idx_daily_rankings_date ON public.daily_rankings(date);

-- 5. votes (user_id from auth.users)
CREATE TABLE IF NOT EXISTS public.votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  news_item_id uuid NOT NULL REFERENCES public.news_items(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('up', 'down')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, news_item_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_user_id ON public.votes(user_id);
CREATE INDEX IF NOT EXISTS idx_votes_news_item_id ON public.votes(news_item_id);

-- 6. preference_prompt (single row; fixed id used in app)
CREATE TABLE IF NOT EXISTS public.preference_prompt (
  id uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  content text NOT NULL DEFAULT '',
  word_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 7. preference_bullet_runs
CREATE TABLE IF NOT EXISTS public.preference_bullet_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  votes_processed int NOT NULL,
  bullets_appended text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 8. reads
CREATE TABLE IF NOT EXISTS public.reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  news_item_id uuid NOT NULL REFERENCES public.news_items(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, news_item_id)
);

CREATE INDEX IF NOT EXISTS idx_reads_user_id ON public.reads(user_id);

-- RLS: enable
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_fetched_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preference_prompt ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preference_bullet_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reads ENABLE ROW LEVEL SECURITY;

-- sources: service role or authenticated can read; only service role can write (cron writes)
CREATE POLICY "sources_read" ON public.sources FOR SELECT TO authenticated, service_role USING (true);
CREATE POLICY "sources_all_service" ON public.sources FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "sources_manage_authenticated" ON public.sources FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- raw_fetched_items: service role for cron; authenticated read for debugging optional
CREATE POLICY "raw_fetched_items_service" ON public.raw_fetched_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "raw_fetched_items_read" ON public.raw_fetched_items FOR SELECT TO authenticated USING (true);

-- news_items: read for all authenticated
CREATE POLICY "news_items_read" ON public.news_items FOR SELECT TO authenticated, service_role USING (true);
CREATE POLICY "news_items_service" ON public.news_items FOR ALL TO service_role USING (true) WITH CHECK (true);

-- daily_rankings: read for authenticated
CREATE POLICY "daily_rankings_read" ON public.daily_rankings FOR SELECT TO authenticated, service_role USING (true);
CREATE POLICY "daily_rankings_service" ON public.daily_rankings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- votes: own user only
CREATE POLICY "votes_own" ON public.votes FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- preference_prompt: read authenticated; write service only (cron/API with service role)
CREATE POLICY "preference_prompt_read" ON public.preference_prompt FOR SELECT TO authenticated, service_role USING (true);
CREATE POLICY "preference_prompt_service" ON public.preference_prompt FOR ALL TO service_role USING (true) WITH CHECK (true);

-- preference_bullet_runs: service and read for authenticated
CREATE POLICY "preference_bullet_runs_read" ON public.preference_bullet_runs FOR SELECT TO authenticated, service_role USING (true);
CREATE POLICY "preference_bullet_runs_service" ON public.preference_bullet_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- reads: own user only
CREATE POLICY "reads_own" ON public.reads FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Seed single preference_prompt row (fixed id for upsert in app)
INSERT INTO public.preference_prompt (id, content, word_count, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, '', 0, now())
ON CONFLICT (id) DO NOTHING;
