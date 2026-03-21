import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDisplayDate } from "./time";

function siteBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`;
  return "";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type SourceRow = { type: string; config: { url?: string; category?: string; keyword?: string } };

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

type RawRow = { raw_content: string | null; source_id: string; sources: SourceRow | null };
type NewsRow = {
  id: string;
  title: string;
  summary: string | null;
  url: string | null;
  raw_fetched_items: RawRow | null;
};

export type DigestRow = {
  rank: number;
  is_surprise: boolean;
  news_item: {
    title: string;
    summary: string | null;
    url: string | null;
    source_label: string | null;
    preview: string | null;
  } | null;
};

export async function loadDigestForDate(
  supabase: SupabaseClient,
  date: string
): Promise<DigestRow[]> {
  const { data: rankings, error } = await supabase
    .from("daily_rankings")
    .select(
      `
      rank, is_surprise,
      news_items (
        id, title, summary, url,
        raw_fetched_items ( raw_content, source_id, sources ( type, config ) )
      )
    `
    )
    .eq("date", date)
    .order("rank", { ascending: true });
  if (error) throw new Error(error.message);

  return (rankings || []).map((r) => {
    const row = r as unknown as {
      rank: number;
      is_surprise: boolean | null;
      news_items: NewsRow | NewsRow[] | null;
    };
    const news = Array.isArray(row.news_items) ? row.news_items[0] : row.news_items;
    const source = news?.raw_fetched_items?.sources ?? null;
    const label = sourceLabel(source);
    const preview = contentPreview(news?.raw_fetched_items?.raw_content ?? null, 400);
    return {
      rank: row.rank,
      is_surprise: row.is_surprise ?? false,
      news_item: news
        ? {
            title: news.title,
            summary: news.summary,
            url: news.url,
            source_label: label,
            preview: preview ?? news.summary ?? null,
          }
        : null,
    };
  });
}

export function buildDigestHtml(date: string, rows: DigestRow[]): string {
  const display = formatDisplayDate(date);
  const base = siteBaseUrl();
  const dashboardLink = base ? `${base}/dashboard` : "";

  const itemsHtml = rows
    .map((row) => {
      const n = row.news_item;
      if (!n) {
        return `<li style="margin:0 0 16px 0;"><strong>${row.rank}.</strong> <em>(missing story)</em></li>`;
      }
      const titleEsc = escapeHtml(n.title);
      const link =
        n.url && n.url.startsWith("http")
          ? `<a href="${escapeHtml(n.url)}" style="color:#2563eb;">${titleEsc}</a>`
          : titleEsc;
      const surprise = row.is_surprise ? ` <span style="color:#7c3aed;font-size:12px;">Surprise pick</span>` : "";
      const meta = [n.source_label ? escapeHtml(n.source_label) : null].filter(Boolean).join(" · ");
      const bodyRaw = n.preview || n.summary || "";
      const body = bodyRaw ? `<p style="margin:8px 0 0 0;color:#444;font-size:14px;line-height:1.45;">${escapeHtml(bodyRaw)}</p>` : "";
      return `<li style="margin:0 0 18px 0;">
  <strong style="font-size:15px;">${row.rank}.</strong> ${link}${surprise}
  ${meta ? `<div style="margin:4px 0 0 0;font-size:12px;color:#666;">${meta}</div>` : ""}
  ${body}
</li>`;
    })
    .join("\n");

  const open = dashboardLink
    ? `<p style="margin:24px 0 0 0;font-size:14px;"><a href="${escapeHtml(dashboardLink)}" style="color:#2563eb;">Open dashboard</a></p>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:640px;margin:0;padding:24px;">
  <h1 style="font-size:20px;margin:0 0 8px 0;">AI News — Top 10</h1>
  <p style="margin:0 0 20px 0;color:#555;font-size:14px;">${escapeHtml(display)}</p>
  <ol style="margin:0;padding-left:20px;">${itemsHtml}</ol>
  ${open}
</body>
</html>`;
}

export async function sendDigestEmail(params: {
  to: string;
  from: string;
  subject: string;
  html: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    throw new Error("RESEND_API_KEY is not set");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: params.from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend error ${res.status}: ${text}`);
  }
}
