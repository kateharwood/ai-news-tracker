import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runIngestOnlyJob } from "@/lib/daily-job";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runIngestOnlyJob();
  return NextResponse.json(result);
}
