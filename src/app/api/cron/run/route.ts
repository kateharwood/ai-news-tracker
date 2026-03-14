import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runDailyJob } from "@/lib/daily-job";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  console.log("[cron/run] POST: auth check");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    console.log("[cron/run] Unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.log("[cron/run] Running daily job for user", user.id);
  const result = await runDailyJob();
  console.log("[cron/run] Result:", result);
  return NextResponse.json(result);
}
