import { describe, expect, test } from "vitest";

import {
  isLikelyTimeoutError,
  isRedditFeedUrl,
  itemDate,
  redditFeedUrl,
} from "@/lib/ingest-helpers";

describe("isRedditFeedUrl", () => {
  test("true for reddit host", () => {
    expect(isRedditFeedUrl("https://www.reddit.com/r/MachineLearning.rss")).toBe(true);
  });

  test("false for unrelated host", () => {
    expect(isRedditFeedUrl("https://news.ycombinator.com/rss")).toBe(false);
  });

  test("handles bad URL gracefully", () => {
    expect(isRedditFeedUrl("not-url")).toBe(false);
  });
});

describe("redditFeedUrl", () => {
  test("appends .rss when missing", () => {
    expect(redditFeedUrl("https://www.reddit.com/r/test")).toContain(".rss");
    expect(redditFeedUrl("https://www.reddit.com/r/test")).toContain("/r/test");
  });

  test("does not double append", () => {
    const u = "https://reddit.com/r/x/.rss/";
    expect(redditFeedUrl(u).toLowerCase()).toContain(".rss");
  });

  test("bad URL falls back to trimmed string", () => {
    expect(redditFeedUrl("  :::  ")).toBe(":::");
  });
});

describe("itemDate", () => {
  test("prefers isoDate over pubDate", () => {
    const d = itemDate({
      isoDate: "2026-01-15T12:00:00.000Z",
      pubDate: "Sat, 01 Jan 2000 00:00:00 GMT",
    });
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  test("missing dates → null", () => {
    expect(itemDate({})).toBeNull();
  });

  test("invalid date string → null", () => {
    expect(itemDate({ pubDate: "not a date" })).toBeNull();
  });
});

describe("isLikelyTimeoutError", () => {
  test.each(["timeout", "aborted", "ETIMEDOUT", "ECONNRESET", "socket hang up", "Fetch failed"])(String.raw`matches "%s"`, (frag) => {
    expect(isLikelyTimeoutError(new Error(`something ${frag} happened`))).toBe(true);
  });

  test("generic error stays false", () => {
    expect(isLikelyTimeoutError(new Error("404 not found"))).toBe(false);
  });

  test("non-Error coercion", () => {
    expect(isLikelyTimeoutError({ message: "" })).toBe(false);
  });
});
