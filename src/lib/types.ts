export type SourceType = "rss";

export interface Source {
  id: string;
  type: SourceType;
  config: { url?: string; category?: string; keyword?: string };
  enabled: boolean;
  created_at: string;
  /** Consecutive ingest runs that threw (reset on success). */
  ingest_failure_streak?: number;
}

export interface RawFetchedItem {
  id: string;
  source_id: string;
  external_id: string;
  title: string;
  raw_content: string | null;
  url: string | null;
  fetched_at: string;
  created_at: string;
}

export interface NewsItem {
  id: string;
  raw_fetched_item_id: string;
  title: string;
  summary: string | null;
  url: string | null;
  included_at: string;
  created_at: string;
}

export interface DailyRanking {
  id: string;
  news_item_id: string;
  rank: number;
  date: string;
  created_at: string;
  news_items?: NewsItem | null;
}

export interface Vote {
  id: string;
  user_id: string;
  news_item_id: string;
  direction: "up" | "down";
  created_at: string;
}

export interface Read {
  id: string;
  user_id: string;
  news_item_id: string;
  read_at: string;
}

export interface PreferencePrompt {
  id: string;
  content: string;
  word_count: number;
  updated_at: string;
}

