/** Pure ranking / diversity helpers for daily digest (extracted for tests). */

export const MAX_DIGEST_SLOTS = 10;
export const MAX_PER_SOURCE = 2;
export const LLM_RANK_DEPTH = 12;

export type RankableNews = {
  id: string;
  title: string;
  summary: string | null;
  url: string | null;
  raw_fetched_items:
    | { source_id?: string; sources?: { type?: string } | { type?: string }[] | null }
    | { source_id?: string; sources?: { type?: string } | { type?: string }[] | null }[]
    | null;
};

export type FinalRankRow = { news_item_id: string; rank: number; is_surprise: boolean };

export function newsSourceKey(item: RankableNews): string {
  const raw = item.raw_fetched_items ?? null;
  const row = Array.isArray(raw) ? raw[0] : raw;
  const sid = row && typeof row === "object" && "source_id" in row ? row.source_id : null;
  if (typeof sid === "string" && sid.length > 0) return `source:${sid}`;
  return `item:${item.id}`;
}

function sourceKeyForNewsId(items: RankableNews[], id: string): string {
  const it = items.find((i) => i.id === id);
  return it ? newsSourceKey(it) : `item:${id}`;
}

export function uniqueIdsInRankOrder(ranking: { news_item_id: string; rank: number }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of ranking) {
    if (seen.has(r.news_item_id)) continue;
    seen.add(r.news_item_id);
    out.push(r.news_item_id);
  }
  return out;
}

function countBySourceKey(rows: FinalRankRow[], sourceKey: (id: string) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const row of rows) {
    const k = sourceKey(row.news_item_id);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** Build up to MAX_DIGEST_SLOTS rows: start from LLM top 9 + surprise (or 10th from model), enforce ≤2 per source, backfill from ranks 10–12 then pool; may return fewer than MAX_DIGEST_SLOTS. */
export function buildDiverseTopRanking(
  items: RankableNews[],
  ranking: { news_item_id: string; rank: number }[],
  rng: () => number = Math.random
): FinalRankRow[] {
  const idToItem = new Map(items.map((i) => [i.id, i]));
  const sourceKeyById = (id: string) => {
    const it = idToItem.get(id);
    return it ? newsSourceKey(it) : `item:${id}`;
  };

  const modelOrder = uniqueIdsInRankOrder(ranking).slice(0, LLM_RANK_DEPTH);
  const modelSet = new Set(modelOrder);
  const top9 = modelOrder.slice(0, 9);
  const outsideModel = items.filter((i) => !modelSet.has(i.id));
  const surpriseId =
    outsideModel.length > 0
      ? outsideModel[Math.floor(rng() * outsideModel.length)].id
      : modelOrder[9] ?? null;

  let rows: FinalRankRow[] = top9.map((news_item_id, i) => ({
    news_item_id,
    rank: i + 1,
    is_surprise: false,
  }));
  if (surpriseId !== null && !rows.some((r) => r.news_item_id === surpriseId)) {
    rows.push({
      news_item_id: surpriseId,
      rank: 10,
      is_surprise: outsideModel.length > 0,
    });
  } else if (rows.length === 9 && modelOrder[9] && !rows.some((r) => r.news_item_id === modelOrder[9])) {
    rows.push({ news_item_id: modelOrder[9], rank: 10, is_surprise: false });
  }

  const renumber = (r: FinalRankRow[]) => r.forEach((row, i) => (row.rank = i + 1));

  const removeOverQuota = (): boolean => {
    const counts = countBySourceKey(rows, (id) => sourceKeyById(id));
    const overKey = Array.from(counts.entries()).find(([, n]) => n > MAX_PER_SOURCE)?.[0];
    if (!overKey) return false;
    const candidates = rows.filter((row) => sourceKeyById(row.news_item_id) === overKey);
    const victim = candidates.reduce((a, b) => (a.rank > b.rank ? a : b));
    rows = rows.filter((row) => row.news_item_id !== victim.news_item_id);
    renumber(rows);
    return true;
  };

  while (removeOverQuota()) {
    /* drain */
  }

  const used = new Set(rows.map((r) => r.news_item_id));
  const replacementQueue: string[] = [];
  for (const id of modelOrder) {
    if (!used.has(id)) replacementQueue.push(id);
  }
  for (const it of items) {
    if (!used.has(it.id) && !replacementQueue.includes(it.id)) replacementQueue.push(it.id);
  }

  const canAdd = (id: string): boolean => {
    const k = sourceKeyById(id);
    const c = countBySourceKey(rows, (nid) => sourceKeyById(nid)).get(k) ?? 0;
    return c < MAX_PER_SOURCE;
  };

  while (rows.length < MAX_DIGEST_SLOTS && replacementQueue.length > 0) {
    const id = replacementQueue.shift()!;
    if (used.has(id) || !canAdd(id)) continue;
    rows.push({ news_item_id: id, rank: rows.length + 1, is_surprise: false });
    used.add(id);
    renumber(rows);
  }

  renumber(rows);
  return rows;
}
