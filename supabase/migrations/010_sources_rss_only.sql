-- Retire arXiv as a source type: remove rows (cascades raw_fetched_items → news_items, etc.) and allow only RSS.

DELETE FROM public.sources WHERE type = 'arxiv';

ALTER TABLE public.sources DROP CONSTRAINT IF EXISTS sources_type_check;

ALTER TABLE public.sources
  ADD CONSTRAINT sources_type_check CHECK (type = 'rss');
