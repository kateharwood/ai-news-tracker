import { NextResponse } from "next/server";
import { parseVoteBody } from "@/lib/vote-validation";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = parseVoteBody(await request.json());
  if (!parsed.ok) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const { news_item_id, direction } = parsed;
  const { error } = await supabase.from("votes").upsert(
    {
      user_id: user.id,
      news_item_id,
      direction,
      created_at: new Date().toISOString(),
    },
    { onConflict: "user_id,news_item_id" }
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
