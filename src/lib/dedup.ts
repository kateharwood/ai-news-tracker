import * as stringSimilarity from "string-similarity";

const TITLE_SIMILARITY_THRESHOLD = 0.85;

export function normalizeUrl(url: string | null): string | null {
  if (!url || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    u.hash = "";
    u.search = "";
    return u.href;
  } catch {
    return null;
  }
}

export function isDuplicateByUrl(
  url: string | null,
  existingUrls: (string | null)[]
): boolean {
  const norm = normalizeUrl(url);
  if (!norm) return false;
  for (const existing of existingUrls) {
    if (normalizeUrl(existing) === norm) return true;
  }
  return false;
}

export function isDuplicateByTitle(
  title: string,
  existingTitles: string[]
): boolean {
  if (!title.trim()) return false;
  for (const existing of existingTitles) {
    const sim = stringSimilarity.compareTwoStrings(
      title.trim().toLowerCase(),
      existing.trim().toLowerCase()
    );
    if (sim >= TITLE_SIMILARITY_THRESHOLD) return true;
  }
  return false;
}

export function isDuplicate(
  url: string | null,
  title: string,
  existing: { url: string | null; title: string }[]
): boolean {
  const urls = existing.map((e) => e.url);
  const titles = existing.map((e) => e.title);
  return isDuplicateByUrl(url, urls) || isDuplicateByTitle(title, titles);
}
