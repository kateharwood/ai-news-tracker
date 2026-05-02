import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import nock from "nock";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { rss2Body } from "../helpers/rss-fixtures";

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => {
    throw new Error("createServiceRoleClient is not used by fetchRssFeed");
  },
}));

import { fetchRssFeed } from "@/lib/ingest";

const recentRssDate = "Sat, 02 May 2026 14:00:00 GMT";

describe("fetchRssFeed (HTTP contract)", () => {
  const rssServer = setupServer();
  beforeAll(() =>
    rssServer.listen({
      onUnhandledRequest: "error",
    })
  );
  afterEach(() => {
    rssServer.resetHandlers();
    nock.cleanAll();
    vi.useRealTimers();
  });
  afterAll(() => rssServer.close());

  test("Reddit path uses fetch + parses items in the 3h window", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-02T15:00:00.000Z").getTime() });

    const xml = rss2Body([
      {
        title: "Post A",
        link: "https://reddit.com/r/ml/a",
        guid: "g-a",
        pubDate: recentRssDate,
        desc: "Body A",
      },
    ]);

    rssServer.use(
      http.get("https://www.reddit.com/r/ml.rss", () => HttpResponse.text(xml, { headers: { "Content-Type": "application/rss+xml" } }))
    );

    const rows = await fetchRssFeed("https://www.reddit.com/r/ml");
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Post A");
    expect(rows[0].guid).toBe("g-a");
    expect(rows[0].link).toMatch(/reddit/);
  });

  test("generic parseURL path uses node http (nock) and skips items older than 3h", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-02T15:00:00.000Z").getTime() });

    const xml = rss2Body([
      {
        title: "Recent",
        link: "https://ex.com/1",
        guid: "gr",
        pubDate: recentRssDate,
        desc: "d",
      },
      {
        title: "Old",
        link: "https://ex.com/2",
        guid: "go",
        pubDate: "Sat, 01 Jan 2000 00:00:00 GMT",
        desc: "",
      },
    ]);

    nock("https://feeds.example.org").get("/news.xml").reply(200, xml, { "Content-Type": "application/rss+xml; charset=utf-8" });

    const rows = await fetchRssFeed("https://feeds.example.org/news.xml");
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Recent");
  });
});
