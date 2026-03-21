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

type StoryVariant = "featured" | "lead" | "mid" | "side" | "rest";

const SERIF = "Georgia,'Times New Roman',Times,serif";
const SANS = "system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const C_ZINC900 = "#18181b";
const C_ZINC600 = "#52525b";
const C_ZINC500 = "#71717a";
const C_ZINC200 = "#e4e4e7";
const C_ZINC100 = "#f4f4f5";
const C_AMBER100 = "#fef3c7";
const C_AMBER800 = "#92400e";
const C_LINK = "#2563eb";

function partitionNewspaper(rows: DigestRow[]) {
  const byRank = new Map(rows.map((r) => [r.rank, r]));
  return {
    featured: byRank.get(1) ?? null,
    lead: [2, 3].map((r) => byRank.get(r)).filter((x): x is DigestRow => Boolean(x)),
    mid: [4, 5].map((r) => byRank.get(r)).filter((x): x is DigestRow => Boolean(x)),
    rightTop: byRank.get(10) ?? null,
    rightRest: [6, 7, 8, 9].map((r) => byRank.get(r)).filter((x): x is DigestRow => Boolean(x)),
  };
}

function excerptForVariant(row: DigestRow, variant: StoryVariant): string {
  const n = row.news_item;
  if (!n) return "";
  if (variant === "rest") {
    const text = (n.summary && n.summary.trim()) || n.preview || "";
    return contentPreview(text, 220) ?? "";
  }
  const text = n.preview || n.summary || "";
  const max =
    variant === "featured"
      ? 520
      : variant === "lead"
        ? 400
        : variant === "mid"
          ? 220
          : variant === "side"
            ? 320
            : 200;
  return contentPreview(text, max) ?? "";
}

function metaBadges(row: DigestRow, metaSize: "sm" | "xs"): string {
  const n = row.news_item;
  const size = metaSize === "sm" ? "13px" : "12px";
  const parts: string[] = [];
  if (row.is_surprise) {
    parts.push(
      `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;font-family:${SANS};background-color:${C_AMBER100};color:${C_AMBER800};">Surprise</span>`
    );
  } else {
    parts.push(
      `<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;font-family:${SANS};background-color:${C_ZINC100};color:${C_ZINC600};">#${row.rank}</span>`
    );
  }
  if (n?.source_label) {
    parts.push(
      `<span style="font-size:${size};font-family:${SANS};color:${C_ZINC500};">${escapeHtml(n.source_label)}</span>`
    );
  }
  return `<div style="line-height:1.4;">${parts.join(' <span style="color:#d4d4d8;">·</span> ')}</div>`;
}

function storyBlock(row: DigestRow, variant: StoryVariant, opts?: { borderBottom?: boolean; midPadding?: "left" | "right" | "none" }): string {
  const n = row.news_item;
  const borderBottom = opts?.borderBottom !== false;
  const bb = borderBottom ? `border-bottom:1px solid ${C_ZINC200};` : "";
  const pad =
    variant === "mid" && opts?.midPadding === "left"
      ? "padding-left:24px;border-left:1px solid #e4e4e7;"
      : variant === "mid" && opts?.midPadding === "right"
        ? "padding-right:24px;"
        : "";
  const py = variant === "featured" ? "padding:4px 8px 0 8px;" : "padding:16px 8px 20px 8px;";

  if (!n) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${bb}${py}"><tr><td style="font-family:${SANS};color:${C_ZINC500};font-size:14px;">#${row.rank} — <em>Story unavailable</em></td></tr></table>`;
  }

  const titleSizes: Record<StoryVariant, string> = {
    featured: "font-size:34px;line-height:1.02;",
    lead: "font-size:26px;line-height:1.2;",
    mid: "font-size:17px;line-height:1.25;",
    side: "font-size:20px;line-height:1.25;",
    rest: "font-size:15px;line-height:1.3;",
  };
  const excerptSizes: Record<StoryVariant, string> = {
    featured: "font-size:16px;line-height:1.55;margin-top:10px;",
    lead: "font-size:14px;line-height:1.55;margin-top:8px;",
    mid: "font-size:14px;line-height:1.5;margin-top:8px;",
    side: "font-size:14px;line-height:1.5;margin-top:8px;",
    rest: "font-size:14px;line-height:1.45;margin-top:6px;",
  };

  const href = n.url && n.url.startsWith("http") ? n.url : null;
  const titleInner = escapeHtml(n.title);
  const titleHtml = href
    ? `<a href="${escapeHtml(href)}" style="color:${C_ZINC900};text-decoration:none;">${titleInner}</a>`
    : titleInner;

  const excerpt = excerptForVariant(row, variant);
  const excerptHtml = excerpt
    ? `<p style="font-family:${SANS};color:${C_ZINC600};${excerptSizes[variant]}margin-bottom:0;">${escapeHtml(excerpt)}</p>`
    : "";

  const metaClass = variant === "featured" ? "sm" : "xs";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${bb}${py}${pad}"><tr><td>
  ${metaBadges(row, metaClass)}
  <h2 style="font-family:${SERIF};font-weight:600;color:${C_ZINC900};margin:8px 0 0 0;${titleSizes[variant]}">${titleHtml}</h2>
  ${excerptHtml}
</td></tr></table>`;
}

export function buildDigestHtml(date: string, rows: DigestRow[]): string {
  const display = formatDisplayDate(date);
  const base = siteBaseUrl();
  const dashboardLink = base ? `${base}/dashboard` : "";

  const { featured, lead, mid, rightTop, rightRest } = partitionNewspaper(rows);

  let leftCol = "";
  if (featured) {
    leftCol += storyBlock(featured, "featured", { borderBottom: false });
  }
  if (lead.length > 0) {
    for (const item of lead) {
      leftCol += storyBlock(item, "lead", { borderBottom: true });
    }
  }
  if (mid.length > 0) {
    leftCol += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>`;
    const m0 = mid[0];
    const m1 = mid[1];
    leftCol += `<td width="50%" valign="top" style="vertical-align:top;">${m0 ? storyBlock(m0, "mid", { borderBottom: true, midPadding: "right" }) : "&nbsp;"}</td>`;
    leftCol += `<td width="50%" valign="top" style="vertical-align:top;">${m1 ? storyBlock(m1, "mid", { borderBottom: true, midPadding: "left" }) : "&nbsp;"}</td>`;
    leftCol += `</tr></table>`;
  }

  let rightCol = "";
  if (rightTop) {
    rightCol += storyBlock(rightTop, "side", { borderBottom: true });
  }
  if (rightRest.length > 0) {
    rightRest.forEach((item, i) => {
      rightCol += storyBlock(item, "rest", { borderBottom: i < rightRest.length - 1 });
    });
  }

  const open = dashboardLink
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;"><tr><td style="font-family:${SANS};font-size:14px;"><a href="${escapeHtml(dashboardLink)}" style="color:${C_LINK};">Open dashboard →</a></td></tr></table>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style type="text/css">
    @media only screen and (max-width: 600px) {
      .np-col-left, .np-col-right { display: block !important; width: 100% !important; max-width: 100% !important; }
      .np-col-right { border-left: none !important; padding-left: 0 !important; margin-top: 8px !important; padding-top: 16px !important; border-top: 1px solid ${C_ZINC200} !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#fafafc;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fafafc;"><tr><td align="center" style="padding:24px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;background-color:#ffffff;border:1px solid ${C_ZINC200};border-radius:12px;overflow:hidden;">
      <tr><td style="padding:24px 24px 8px 24px;font-family:${SANS};">
        <h1 style="margin:0;font-size:22px;font-weight:600;color:${C_ZINC900};">Today’s Top 10<span style="color:${C_ZINC500};font-weight:400;"> · ${escapeHtml(display)}</span></h1>
      </td></tr>
      <tr><td style="padding:0 16px 24px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="np-main" style="border-collapse:collapse;">
          <tr>
            <td class="np-col-left" width="58%" valign="top" style="vertical-align:top;padding-right:12px;">${leftCol || "&nbsp;"}</td>
            <td class="np-col-right" width="42%" valign="top" style="vertical-align:top;border-left:1px solid ${C_ZINC200};padding-left:20px;">${rightCol || ""}</td>
          </tr>
        </table>
        ${open}
      </td></tr>
    </table>
  </td></tr></table>
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
