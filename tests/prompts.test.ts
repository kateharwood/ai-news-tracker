import { describe, expect, test } from "vitest";

import { substitutePrompt } from "@/lib/prompts";

describe("substitutePrompt", () => {
  test("replaces placeholders globally", () => {
    expect(substitutePrompt("{{x}}-{{x}}", { x: "a" })).toBe("a-a");
  });

  test("handles empty string vars", () => {
    expect(substitutePrompt("{{a}}-{{b}}", { a: "", b: "" })).toBe("-");
  });

  test("handles keys with underscore", () => {
    expect(substitutePrompt("{{preference_prompt}}", { preference_prompt: "like AI" })).toBe("like AI");
  });

  test("literal dollar signs or regex chars in substitution value are literal", () => {
    expect(substitutePrompt("<<{{v}}>>", { v: "a.$" })).toBe("<<a.$>>");
  });

  test("unknown placeholders left intact", () => {
    expect(substitutePrompt("{{known}} {{unknown}}", { known: "x" })).toBe("x {{unknown}}");
  });
});
