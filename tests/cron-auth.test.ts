import { describe, expect, test } from "vitest";

import { isCronAuthorized } from "@/lib/cron-auth";

describe("isCronAuthorized", () => {
  test("allows when cron secret unset (local/dev)", () => {
    expect(isCronAuthorized(null, undefined)).toBe(true);
    expect(isCronAuthorized("Bearer wrong", undefined)).toBe(true);
  });

  test("allows exact bearer match", () => {
    expect(isCronAuthorized("Bearer s3cret", "s3cret")).toBe(true);
  });

  test.each([
    ["missing header", null, "secret"],
    ["wrong token", "Bearer other", "secret"],
    ["missing Bearer prefix", "secret", "secret"],
    ["case mismatch on Bearer-only", "bearer secret", "secret"],
  ])("%s", (_label, header, secret) => {
    expect(isCronAuthorized(header, secret)).toBe(false);
  });
});
