import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { isCronAuthorized } from "@/lib/cron-auth";
import {
  buildDigestHtml,
  loadDigestForDate,
  sendDigestEmail,
} from "@/lib/email-digest";
import { formatDisplayDate, todayEastern } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!isCronAuthorized(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const to = process.env.EMAIL_DIGEST_TO?.trim();
  const from = process.env.EMAIL_DIGEST_FROM?.trim();
  if (!to || !from) {
    return NextResponse.json(
      {
        skipped: true,
        reason: "EMAIL_DIGEST_TO or EMAIL_DIGEST_FROM not configured",
      },
      { status: 200 }
    );
  }

  if (!process.env.RESEND_API_KEY?.trim()) {
    return NextResponse.json(
      { skipped: true, reason: "RESEND_API_KEY not configured" },
      { status: 200 }
    );
  }

  const supabase = createServiceRoleClient();
  const date = todayEastern();

  const { data: already } = await supabase
    .from("email_digest_sent")
    .select("date")
    .eq("date", date)
    .maybeSingle();

  if (already) {
    return NextResponse.json({
      skipped: true,
      reason: "already_sent",
      date,
    });
  }

  try {
    const rows = await loadDigestForDate(supabase, date);
    if (rows.length === 0) {
      return NextResponse.json({
        skipped: true,
        reason: "no_rankings_for_date",
        date,
      });
    }

    const html = buildDigestHtml(date, rows);
    const display = formatDisplayDate(date);
    await sendDigestEmail({
      to,
      from,
      subject: `AI News — Top 10 · ${display}`,
      html,
    });

    const { error: insErr } = await supabase.from("email_digest_sent").insert({ date });
    if (insErr) {
      console.error("[email-digest] sent email but failed to record:", insErr);
    }

    return NextResponse.json({ sent: true, date, count: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[email-digest]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
