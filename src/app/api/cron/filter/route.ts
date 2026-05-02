import { NextResponse } from "next/server";
import { runFilterOnlyJob } from "@/lib/daily-job";
import { isCronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!isCronAuthorized(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runFilterOnlyJob();
  return NextResponse.json(result);
}
