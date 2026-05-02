import { describe, expect, test } from "vitest";

import { parseVoteBody } from "@/lib/vote-validation";

describe("parseVoteBody", () => {
  test("happy path up/down", () => {
    expect(parseVoteBody({ news_item_id: "uuid-1", direction: "up" })).toEqual({
      ok: true,
      news_item_id: "uuid-1",
      direction: "up",
    });
    expect(parseVoteBody({ news_item_id: "uuid-2", direction: "down" }).ok).toEqual(true);
  });

  test("rejects non-object", () => {
    expect(parseVoteBody(null).ok).toBe(false);
    expect(parseVoteBody("oops").ok).toBe(false);
    expect(parseVoteBody(123).ok).toBe(false);
  });

  test("rejects empty id or non-string id", () => {
    expect(parseVoteBody({ news_item_id: "", direction: "up" }).ok).toBe(false);
    expect(parseVoteBody({ news_item_id: 1, direction: "up" }).ok).toBe(false);
    expect(parseVoteBody({ direction: "up" }).ok).toBe(false);
  });

  test("rejects invalid direction", () => {
    expect(parseVoteBody({ news_item_id: "x", direction: "SIDEWAYS" }).ok).toBe(false);
    expect(parseVoteBody({ news_item_id: "x", direction: "UP" }).ok).toBe(false);
  });
});
