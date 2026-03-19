import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date) {
    return NextResponse.json({ error: "date required" }, { status: 400 });
  }
  const { data: rankings, error } = await supabase
    .from("daily_rankings")
    .select(
      `
      id, rank, date, news_item_id, is_surprise,
      news_items (
        id, title, summary, url, included_at,
        raw_fetched_items ( raw_content, source_id, sources ( type, config ) )
      )
    `
    )
    .eq("date", date)
    .order("rank", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const { data: votes } = await supabase
    .from("votes")
    .select("news_item_id, direction")
    .eq("user_id", user.id);
  const voteMap = new Map(
    (votes || []).map((v) => [v.news_item_id, v.direction as "up" | "down"])
  );
  const { data: reads } = await supabase
    .from("reads")
    .select("news_item_id")
    .eq("user_id", user.id);
  const readSet = new Set((reads || []).map((r) => r.news_item_id));
  type SourceRow = { type: string; config: { url?: string; category?: string; keyword?: string } };
  type RawRow = { raw_content: string | null; source_id: string; sources: SourceRow | null };
  type NewsRow = {
    id: string;
    title: string;
    summary: string | null;
    url: string | null;
    included_at: string;
    raw_fetched_items: RawRow | null;
  };
  type Row = {
    id: string;
    rank: number;
    date: string;
    news_item_id: string;
    is_surprise: boolean;
    news_items: NewsRow | null;
  };
  function sourceLabel(source: SourceRow | null | undefined): string | null {
    if (!source) return null;
    const cfg = source.config ?? {};
    if (source.type === "rss" && cfg.url) {
      try {
        return new URL(cfg.url.trim()).hostname;
      } catch {
        return cfg.url;
      }
    }
    if (source.type === "arxiv") {
      return [cfg.category, cfg.keyword].filter(Boolean).join(" + ") || null;
    }
    return null;
  }

  function contentPreview(text: string | null | undefined, maxChars: number): string | null {
    const cleaned = (text ?? "").replace(/\s+/g, " ").trim();
    if (!cleaned) return null;
    if (cleaned.length <= maxChars) return cleaned;
    return cleaned.slice(0, maxChars).trimEnd() + "...";
  }

  const items = (rankings || []).map((r) => {
    const row = r as unknown as Row;
    const news = Array.isArray(row.news_items) ? row.news_items[0] : row.news_items;
    const source = news?.raw_fetched_items?.sources ?? null;
    const label = sourceLabel(source);
    // Top-story previews should feel like a real "lede", but remain bounded.
    const preview = contentPreview(news?.raw_fetched_items?.raw_content ?? null, 2000);
    return {
      id: row.id,
      rank: row.rank,
      date: row.date,
      news_item_id: row.news_item_id,
      is_surprise: row.is_surprise ?? false,
      news_item: news
        ? {
            id: news.id,
            title: news.title,
            summary: news.summary,
            url: news.url,
            included_at: news.included_at,
            source_label: label,
            content_preview: preview ?? news.summary ?? null,
          }
        : null,
      vote: voteMap.get(row.news_item_id) ?? null,
      read: readSet.has(row.news_item_id),
    };
  });
  return NextResponse.json({ date, items });
}
