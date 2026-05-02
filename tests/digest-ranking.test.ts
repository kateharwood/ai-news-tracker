import { describe, expect, test } from "vitest";

import {
  MAX_DIGEST_SLOTS,
  MAX_PER_SOURCE,
  buildDiverseTopRanking,
  newsSourceKey,
  uniqueIdsInRankOrder,
  type RankableNews,
} from "@/lib/digest-ranking";

function item(id: string, sid: string | null): RankableNews {
  return {
    id,
    title: id,
    summary: "",
    url: null,
    raw_fetched_items: sid
      ? ({ source_id: sid, sources: { type: "rss" } } as RankableNews["raw_fetched_items"])
      : null,
  };
}

describe("newsSourceKey", () => {
  test("falls back to item id without source_id", () => {
    expect(newsSourceKey(item("n1", null))).toBe("item:n1");
  });

  test("prefers source_id string", () => {
    expect(newsSourceKey(item("n1", "src-a"))).toBe("source:src-a");
  });
});

describe("uniqueIdsInRankOrder", () => {
  test("drops duplicate IDs keeping first occurrence order", () => {
    expect(
      uniqueIdsInRankOrder([
        { news_item_id: "a", rank: 1 },
        { news_item_id: "a", rank: 2 },
        { news_item_id: "b", rank: 3 },
      ])
    ).toEqual(["a", "b"]);
  });
});

describe("buildDiverseTopRanking", () => {
  test("fills top 10 with distinct sources capped at MAX_PER_SOURCE", () => {
    const items = Array.from({ length: 15 }, (_, i) => item(`id${i}`, `s${Math.floor(i / 3)}`));
    const ranking = items.slice(0, 12).map((it, idx) => ({ news_item_id: it.id, rank: idx + 1 }));

    const out = buildDiverseTopRanking(items, ranking, () => 0);

    expect(out.length).toBeLessThanOrEqual(MAX_DIGEST_SLOTS);
    const bySource = new Map<string, number>();
    for (const r of out) {
      const k = newsSourceKey(items.find((x) => x.id === r.news_item_id)!);
      bySource.set(k, (bySource.get(k) ?? 0) + 1);
    }
    expect(Math.max(0, ...Array.from(bySource.values()))).toBeLessThanOrEqual(MAX_PER_SOURCE);
    expect(out.map((r) => r.rank)).toEqual(out.map((_, i) => i + 1));
  });

  test("deterministic surprise slot with rng picking first outside-model item", () => {
    const items = [
      ...Array.from({ length: 9 }, (_, i) => item(`m${i}`, `s${i}`)),
      item("outside", "s-out"),
    ];

    const modelOrder = items.slice(0, 9).map((it, i) => ({ news_item_id: it.id, rank: i + 1 }));
    const out = buildDiverseTopRanking(items, modelOrder, () => 0);

    expect(out.find((r) => r.rank === 10)?.news_item_id).toBe("outside");
    expect(out.find((r) => r.rank === 10)?.is_surprise).toBe(true);
  });

  test("duplicate ranks in LLM output dedup before slice", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"].map((x) =>
      item(x, x)
    );
    const ranking = [
      ...items.slice(0, 9).map((it, i) => ({ news_item_id: it.id, rank: i + 1 })),
      { news_item_id: "ghost", rank: 9 },
      { news_item_id: "ghost", rank: 10 },
      { news_item_id: "k", rank: 11 },
    ];

    const out = buildDiverseTopRanking(items, ranking);
    expect(new Set(out.map((r) => r.news_item_id)).size).toBe(out.length);
  });
});
