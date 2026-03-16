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
      id, rank, date, news_item_id,
      news_items (
        id, title, summary, url, included_at,
        raw_fetched_items ( source_id, sources ( type, config ) )
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
  type RawRow = { source_id: string; sources: SourceRow | null };
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
  const items = (rankings || []).map((r: Row) => {
    const news = r.news_items;
    const source = news?.raw_fetched_items?.sources ?? null;
    const label = sourceLabel(source);
    return {
      id: r.id,
      rank: r.rank,
      date: r.date,
      news_item_id: r.news_item_id,
      news_item: news
        ? {
            id: news.id,
            title: news.title,
            summary: news.summary,
            url: news.url,
            included_at: news.included_at,
            source_label: label,
          }
        : null,
      vote: voteMap.get(r.news_item_id) ?? null,
      read: readSet.has(r.news_item_id),
    };
  });
  return NextResponse.json({ date, items });
}
