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
      news_items ( id, title, summary, url, included_at )
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
  type Row = {
    id: string;
    rank: number;
    date: string;
    news_item_id: string;
    news_items: unknown;
  };
  const items = (rankings || []).map((r: Row) => ({
    id: r.id,
    rank: r.rank,
    date: r.date,
    news_item_id: r.news_item_id,
    news_item: r.news_items,
    vote: voteMap.get(r.news_item_id) ?? null,
    read: readSet.has(r.news_item_id),
  }));
  return NextResponse.json({ date, items });
}
