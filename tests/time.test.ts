import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { formatDisplayDate, rolling24HoursAgo, toISOSimple } from "@/lib/time";

describe("formatDisplayDate", () => {
  test("YYYY-MM-DD local noon anchor", () => {
    expect(formatDisplayDate("2026-03-14")).toBe("March 14th, 2026");
  });

  test("11th uses th ordinal", () => {
    expect(formatDisplayDate("2026-06-11")).toBe("June 11th, 2026");
  });

  test("ISO strings parse", () => {
    expect(formatDisplayDate("2026-01-02T00:00:00.000Z")).toMatch(/^January /);
  });

  test("invalid date returns original string", () => {
    expect(formatDisplayDate("not-a-date")).toBe("not-a-date");
  });
});

describe("rolling24HoursAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T14:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("approximately 24h before fixed now", () => {
    const t = rolling24HoursAgo().getTime();
    const expected = new Date("2026-05-01T14:00:00.000Z").getTime();
    expect(Math.abs(t - expected)).toBeLessThan(1000);
  });
});

describe("toISOSimple", () => {
  test("serializes fixed date", () => {
    const d = new Date("2026-07-04T12:00:00.000Z");
    expect(toISOSimple(d)).toBe(d.toISOString());
  });
});
