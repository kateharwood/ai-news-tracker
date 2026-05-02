import { describe, expect, test } from "vitest";

import {
  interpretFilterDecision,
  parseRankTop12FromModelText,
  wordCount,
} from "@/lib/claude";

describe("interpretFilterDecision", () => {
  test('INCLUDED substring wins', () => {
    expect(interpretFilterDecision("This should be INCLUDED because AI")).toBe("INCLUDED");
  });

  test('EXCLUDED when no INCLUDED token', () => {
    expect(interpretFilterDecision("EXCLUDED — not relevant")).toBe("EXCLUDED");
  });

  test("NOT INCLUDED counts as INCLUDED substring (know limitation)", () => {
    expect(interpretFilterDecision("NOT INCLUDED per policy")).toBe("INCLUDED");
  });

  test("whitespace only → EXCLUDED", () => {
    expect(interpretFilterDecision(" \n")).toBe("EXCLUDED");
  });
});

describe("parseRankTop12FromModelText", () => {
  test("parses array embedded in prose", () => {
    const raw = String.raw`
Here you go:
[{"news_item_id":"a","rank":2},{"news_item_id":"b","rank":1}]
Done.
`;
    expect(parseRankTop12FromModelText(raw)).toEqual([
      { news_item_id: "b", rank: 1 },
      { news_item_id: "a", rank: 2 },
    ]);
  });

  test("truncates beyond 12", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      news_item_id: `id${i}`,
      rank: i + 1,
    }));
    const parsed = parseRankTop12FromModelText(`blah ${JSON.stringify(rows)} blah`);
    expect(parsed).toHaveLength(12);
    expect(parsed[0].rank).toBe(1);
  });

  test("missing array → empty", () => {
    expect(parseRankTop12FromModelText("no brackets")).toEqual([]);
  });

  test("invalid JSON → empty", () => {
    expect(parseRankTop12FromModelText("[{oops")).toEqual([]);
  });
});

describe("wordCount", () => {
  test("handles extra whitespace", () => {
    expect(wordCount("  a   b\tc\n")).toBe(3);
  });

  test("empty and whitespace → 0", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("  ")).toBe(0);
  });
});
