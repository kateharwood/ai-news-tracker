import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, vi, test } from "vitest";

import { anthropicSequentialHandler } from "../helpers/msw-anthropic";
import { assertSupabaseQueueEmpty, seedSupabaseQueue } from "../helpers/supabase-queue-mock";

vi.mock("@/lib/supabase/service", () => import("../helpers/supabase-service-test"));

describe("runFilterOnlyJob (mocked Supabase + Anthropic API)", () => {
  const replies = vi.hoisted(() => ({ texts: [] as string[] }));
  const { handler: anthropicHandler, resetSequentialIndex } = anthropicSequentialHandler(() => replies.texts);
  const server = setupServer(anthropicHandler);

  beforeAll(() =>
    server.listen({
      onUnhandledRequest: "error",
    })
  );
  afterEach(() => {
    resetSequentialIndex();
    server.resetHandlers();
    server.use(anthropicHandler);
  });
  afterAll(() => server.close());

  test("INCLUDE vs EXCLUDE: two distinct stories → one Claude include, one Claude exclude, one news row", async () => {
    replies.texts = ["INCLUDED", "EXCLUDED"];

    seedSupabaseQueue([
      { data: { content: "" }, error: null },
      { count: 0, error: null },
      { error: null },
      {
        data: [
          {
            id: "raw-1",
            title: "AI Alpha",
            raw_content: "Enough body text to skip summarizeItem path. ".repeat(3),
            url: "https://news.example/a?utm=1",
            source_id: "src-1",
            sources: { type: "rss", config: { url: "https://src.example/feed" } },
          },
          {
            id: "raw-2",
            title: "Sports scores",
            raw_content: "Soccer",
            url: "https://news.example/b",
            source_id: "src-2",
            sources: { type: "rss", config: { url: "https://other.example/feed" } },
          },
        ],
        error: null,
      },
      { data: [], error: null },
      { error: null },
      { data: { id: "news-new-1" }, error: null },
      { error: null },
    ]);

    const { runFilterOnlyJob } = await import("@/lib/daily-job");
    const out = await runFilterOnlyJob();

    expect(out.filtered).toBe(1);
    expect(out.skipped_stale).toBe(0);
    expect(out.error).toBeUndefined();
    assertSupabaseQueueEmpty();
  });

  test("skips pending raw that matches normalized URL already in news_items (no Claude)", async () => {
    replies.texts = [];

    seedSupabaseQueue([
      { data: { content: "" }, error: null },
      { count: 0, error: null },
      { error: null },
      {
        data: [
          {
            id: "raw-skipped-existing",
            title: "Some headline",
            raw_content: "Snippet",
            url: "https://news.example/feature?ref=rss&utm=1",
            source_id: "src-9",
            sources: { type: "rss", config: { url: "https://src.example/f" } },
          },
        ],
        error: null,
      },
      {
        data: [{ url: "https://news.example/feature", title: "Older saved copy" }],
        error: null,
      },
    ]);

    const { runFilterOnlyJob } = await import("@/lib/daily-job");
    const out = await runFilterOnlyJob();

    expect(out.filtered).toBe(0);
    expect(out.error).toBeUndefined();
    assertSupabaseQueueEmpty();
  });

  test("skips duplicate among pending rows (same canonical URL): only first row is Claude-filtered", async () => {
    replies.texts = ["INCLUDED"];

    seedSupabaseQueue([
      { data: { content: "" }, error: null },
      { count: 0, error: null },
      { error: null },
      {
        data: [
          {
            id: "raw-newest",
            title: "Seen first — newest fetched_at",
            raw_content: "Body text stays long enough ".repeat(2),
            url: "https://news.example/report?utm=first",
            source_id: "s-a",
            sources: { type: "rss", config: { url: "https://a.example/rss" } },
          },
          {
            id: "raw-older-dup-url",
            title: "Different title same story URL",
            raw_content: "Other",
            url: "https://news.example/report#tab",
            source_id: "s-b",
            sources: { type: "rss", config: { url: "https://b.example/rss" } },
          },
        ],
        error: null,
      },
      { data: [], error: null },
      { error: null },
      { data: { id: "news-one" }, error: null },
    ]);

    const { runFilterOnlyJob } = await import("@/lib/daily-job");
    const out = await runFilterOnlyJob();

    expect(out.filtered).toBe(1);
    expect(out.error).toBeUndefined();
    assertSupabaseQueueEmpty();
  });
});
