import { describe, expect, test } from "vitest";

import { loadPrompt } from "@/lib/prompts";

describe("loadPrompt", () => {
  test.each(["filter_item", "summarize_item", "rank_top12", "preferences_to_bullets", "condense_prompt"])(
    "loads %s template from disk",
    (name) => {
      const text = loadPrompt(name);
      expect(text.length).toBeGreaterThan(50);
      expect(typeof text).toBe("string");
    }
  );

  test("filter_item declares preference placeholder", () => {
    expect(loadPrompt("filter_item")).toContain("{{preference_prompt}}");
  });

  test("rank_top12 references items placeholder", () => {
    expect(loadPrompt("rank_top12")).toContain("{{items}}");
  });
});
