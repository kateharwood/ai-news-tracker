/** Pure helpers extracted from ingest for testing and reuse. */

export function isRedditFeedUrl(url: string): boolean {
  try {
    return new URL(url.trim()).hostname.toLowerCase().includes("reddit.com");
  } catch {
    return false;
  }
}

/** Reddit serves RSS at path ending in .rss; normalize so we hit the feed. */
export function redditFeedUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const u = new URL(trimmed);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    if (!path.toLowerCase().endsWith(".rss")) {
      u.pathname = path + ".rss";
    }
    return u.toString();
  } catch {
    return trimmed;
  }
}

export function itemDate(item: { pubDate?: string; isoDate?: string }): Date | null {
  const raw = item.isoDate || item.pubDate;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isLikelyTimeoutError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /timeout|timed out|aborted|abort|ETIMEDOUT|ECONNRESET|socket hang up|fetch failed/i.test(msg);
}
