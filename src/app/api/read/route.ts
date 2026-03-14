import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  const { news_item_id } = body;
  if (!news_item_id) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const { error } = await supabase.from("reads").upsert(
    {
      user_id: user.id,
      news_item_id,
      read_at: new Date().toISOString(),
    },
    { onConflict: "user_id,news_item_id" }
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
