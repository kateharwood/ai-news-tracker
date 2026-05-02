import { describe, expect, test } from "vitest";

import {
  isDuplicate,
  isDuplicateByTitle,
  isDuplicateByUrl,
  normalizeUrl,
} from "@/lib/dedup";

describe("normalizeUrl", () => {
  test("strips hash and query, keeps scheme/host/path", () => {
    expect(normalizeUrl("https://Example.com/news/a?utm=1#frag")).toBe("https://example.com/news/a");
  });

  test("returns null for empty or whitespace-only", () => {
    expect(normalizeUrl(null)).toBeNull();
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
  });

  test("returns null for invalid URL strings", () => {
    expect(normalizeUrl("not a url")).toBeNull();
  });

  test("handles valid http URL", () => {
    expect(normalizeUrl("http://host/path/")).toBe("http://host/path/");
  });
});

describe("isDuplicateByUrl", () => {
  test("false when probe URL cannot normalize", () => {
    expect(isDuplicateByUrl("bogus", ["https://a.com/x"])).toBe(false);
  });

  test("detects normalized match ignoring query/hash", () => {
    expect(
      isDuplicateByUrl("https://site.com/article?id=1", ["https://site.com/article?utm=y"])
    ).toBe(true);
  });

  test("does not confuse different paths", () => {
    expect(isDuplicateByUrl("https://site.com/a", ["https://site.com/b"])).toBe(false);
  });
});

describe("isDuplicateByTitle", () => {
  test("returns false for blank titles", () => {
    expect(isDuplicateByTitle("   ", ["Hello world"])).toBe(false);
  });

  test("matches high similarity titles (≥0.85)", () => {
    const a = "Breaking: frontier lab ships new multimodal reasoning model";
    const b = "breaking frontier lab ships new multimodal reasoning model!";
    expect(isDuplicateByTitle(a, [b])).toBe(true);
  });

  test("different enough titles are not duplicates", () => {
    expect(isDuplicateByTitle("Apple earnings beat", ["Fed raises rates"])).toBe(false);
  });

  test("trim and case insensitive", () => {
    expect(isDuplicateByTitle(" SAME TITLE HERE ", ["same title here"])).toBe(true);
  });
});

describe("isDuplicate", () => {
  test("duplicate by URL short-circuit", () => {
    expect(
      isDuplicate("https://x.com/u?a=1", "different title entirely", [{ url: "https://x.com/u", title: "other" }])
    ).toBe(true);
  });

  test("duplicate by title when URLs differ", () => {
    const title = "Claude launches new capability for developers everywhere";
    expect(
      isDuplicate("https://a.com", title, [{ url: "https://b.com", title }])
    ).toBe(true);
  });

  test("fresh story", () => {
    expect(isDuplicate("https://new.example/p", "Unique headline here", [{ url: "https://old.example", title: "Other" }])).toBe(
      false
    );
  });
});
