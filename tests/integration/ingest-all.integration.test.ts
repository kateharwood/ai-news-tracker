import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { rss2Body } from "../helpers/rss-fixtures";
import { assertSupabaseQueueEmpty, seedSupabaseQueue } from "../helpers/supabase-queue-mock";

vi.mock("@/lib/supabase/service", () => import("../helpers/supabase-service-test"));

describe("ingestAll (mocked Supabase + RSS via MSW)", () => {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => {
    server.resetHandlers();
    vi.useRealTimers();
  });
  afterAll(() => server.close());

  test("loads enabled rss sources and upserts each recent feed item", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-02T15:30:00.000Z").getTime() });

    const xml = rss2Body([
      {
        title: "Headline One",
        link: "https://site.example/p/1",
        guid: "guid-1",
        pubDate: "Sat, 02 May 2026 14:00:00 GMT",
        desc: "Preview one",
      },
      {
        title: "Headline Two",
        link: "https://site.example/p/2",
        guid: "guid-2",
        pubDate: "Sat, 02 May 2026 13:59:59 GMT",
        desc: "Preview two",
      },
    ]);

    server.use(
      http.get("https://feedsfixture.example/ai.xml", () =>
        HttpResponse.text(xml, { headers: { "Content-Type": "application/rss+xml" } })
      )
    );

    seedSupabaseQueue([
      {
        data: [
          {
            id: "source-uuid-1",
            type: "rss",
            enabled: true,
            config: { url: "https://feedsfixture.example/ai.xml" },
          } as Record<string, unknown>,
        ],
        error: null,
      },
      { error: null },
      { error: null },
      { error: null },
      { error: null },
    ]);

    const { ingestAll } = await import("@/lib/ingest");
    const { inserted } = await ingestAll();

    expect(inserted).toBe(2);
    assertSupabaseQueueEmpty();
  });

  test("counts only successful upserts when one fails", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-02T16:00:00.000Z").getTime() });

    const xml = rss2Body([
      {
        title: "A",
        link: "https://x/a",
        guid: "ga",
        pubDate: "Sat, 02 May 2026 15:59:59 GMT",
        desc: "",
      },
      {
        title: "B",
        link: "https://x/b",
        guid: "gb",
        pubDate: "Sat, 02 May 2026 15:58:58 GMT",
        desc: "",
      },
    ]);

    server.use(
      http.get("https://feedsfixture.example/partial.xml", () =>
        HttpResponse.text(xml, { headers: { "Content-Type": "application/rss+xml" } })
      )
    );

    seedSupabaseQueue([
      {
        data: [
          {
            id: "src-2",
            type: "rss",
            enabled: true,
            config: { url: "https://feedsfixture.example/partial.xml" },
          } as Record<string, unknown>,
        ],
        error: null,
      },
      { error: null },
      { error: { message: "duplicate key violates unique constraint" } },
      { error: null },
      { error: null },
    ]);

    const { ingestAll } = await import("@/lib/ingest");
    const { inserted } = await ingestAll();

    expect(inserted).toBe(1);
    assertSupabaseQueueEmpty();
  });
});
