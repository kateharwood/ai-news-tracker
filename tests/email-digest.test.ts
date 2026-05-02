import { beforeEach, describe, expect, test } from "vitest";

import { buildDigestHtml, type DigestRow } from "@/lib/email-digest";

function row(rank: number, opts: Partial<DigestRow["news_item"]> & { title: string }): DigestRow {
  return {
    rank,
    is_surprise: false,
    news_item: {
      summary: null,
      url: null,
      source_label: null,
      preview: null,
      ...opts,
    },
  };
}

describe("buildDigestHtml", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_URL;
  });

  test("escapes XSS in titles and excerpts", () => {
    const malicious = `<img src=x onerror=alert(1)>`;
    const html = buildDigestHtml("2026-05-02", [
      row(1, {
        title: `Hello<script>bad()</script>`,
        url: "javascript:alert(1)",
        summary: "ignored when preview set",
        preview: malicious,
      }),
    ]);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  test("puts valid http URL in anchor href", () => {
    const html = buildDigestHtml("2026-05-02", [
      row(1, { title: "Story", url: "https://example.com/a?x=1" }),
    ]);
    expect(html).toContain('href="https://example.com/a?x=1"');
  });

  test("snapshot surprise badge wording", () => {
    const html = buildDigestHtml("2026-01-01", [
      { rank: 1, is_surprise: true, news_item: { title: "Wild card", summary: "", url: null, source_label: "src", preview: "p" } },
    ]);
    expect(html).toContain("Surprise");
  });
});
