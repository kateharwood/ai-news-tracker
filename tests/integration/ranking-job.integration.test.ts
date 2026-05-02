import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { anthropicSequentialHandler } from "../helpers/msw-anthropic";
import { assertSupabaseQueueEmpty, seedSupabaseQueue } from "../helpers/supabase-queue-mock";

vi.mock("@/lib/supabase/service", () => import("../helpers/supabase-service-test"));

describe("runRankingJob (mocked Supabase + Anthropic API)", () => {
  const replies = vi.hoisted(() => ({
    texts: [
      JSON.stringify([
        { news_item_id: "n1", rank: 1 },
        { news_item_id: "n2", rank: 2 },
      ]),
    ] as string[],
  }));
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

  test("loads candidates, ranks via LLM JSON, writes daily_rankings inserts", async () => {
    seedSupabaseQueue([
      { data: { content: "" }, error: null },
      {
        data: [
          {
            id: "n1",
            title: "One",
            summary: "s1",
            url: "http://a",
            raw_fetched_items: { source_id: "src-a", sources: { type: "rss" } },
          },
          {
            id: "n2",
            title: "Two",
            summary: "s2",
            url: "http://b",
            raw_fetched_items: { source_id: "src-b", sources: { type: "rss" } },
          },
        ],
        error: null,
      },
      { error: null },
      { error: null },
      { error: null },
    ]);

    const { runRankingJob } = await import("@/lib/daily-job");
    const out = await runRankingJob();

    expect(out.ranked).toBe(2);
    expect(out.error).toBeUndefined();
    assertSupabaseQueueEmpty();
  });
});
