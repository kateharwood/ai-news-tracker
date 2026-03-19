"use client";

import { useEffect, useState } from "react";

interface Item {
  id: string;
  rank: number;
  date: string;
  news_item_id: string;
  is_surprise: boolean;
  news_item: {
    id: string;
    title: string;
    summary: string | null;
    content_preview: string | null;
    url: string | null;
    source_label: string | null;
  };
  vote: "up" | "down" | null;
  read: boolean;
}

export function RankingsList({ date }: { date: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/rankings?date=${encodeURIComponent(date)}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items ?? []);
      })
      .finally(() => setLoading(false));
  }, [date]);

  async function vote(newsItemId: string, direction: "up" | "down") {
    await fetch("/api/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ news_item_id: newsItemId, direction }),
    });
    setItems((prev) =>
      prev.map((i) =>
        i.news_item_id === newsItemId ? { ...i, vote: direction } : i
      )
    );
    fetch("/api/run-preferences", { method: "POST" }).catch(() => {});
  }

  async function markRead(newsItemId: string) {
    await fetch("/api/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ news_item_id: newsItemId }),
    });
    setItems((prev) =>
      prev.map((i) =>
        i.news_item_id === newsItemId ? { ...i, read: true } : i
      )
    );
  }

  const filtered = items;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-500 py-8">
        <span className="inline-block w-5 h-5 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
        Loading…
      </div>
    );
  }
  if (filtered.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-zinc-200 p-8 text-center text-zinc-500 shadow-sm">
        <p>No rankings for this day.</p>
        <p className="mt-1 text-sm">Use “Fetch & rank news” above to run the daily job.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {(() => {
        // Use the first few visible stories so layout still feels "news-homepage" when hiding read items.
        const byRank = new Map<number, Item>(filtered.map((i) => [i.rank, i]));

        const featured = byRank.get(1) ?? null;
        const lead = [2, 3].map((r) => byRank.get(r)).filter((x): x is Item => Boolean(x));
        const mid = [4, 5].map((r) => byRank.get(r)).filter((x): x is Item => Boolean(x));

        // Debugging requirement: ranks #10, #6, #7, #8, #9 should be in the right column.
        const rightTop = byRank.get(10) ?? null;
        const rightRest = [6, 7, 8, 9].map((r) => byRank.get(r)).filter((x): x is Item => Boolean(x));

        function Controls({ item }: { item: Item }) {
          return (
            <div className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={() => vote(item.news_item_id, "up")}
                className={`p-2 rounded-lg transition-colors ${
                  item.vote === "up"
                    ? "bg-emerald-100 text-emerald-700"
                    : "text-zinc-400 hover:bg-zinc-100 hover:text-emerald-600"
                }`}
                title="More like this"
              >
                <span className="sr-only">Upvote</span>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => vote(item.news_item_id, "down")}
                className={`p-2 rounded-lg transition-colors ${
                  item.vote === "down"
                    ? "bg-red-100 text-red-600"
                    : "text-zinc-400 hover:bg-zinc-100 hover:text-red-500"
                }`}
                title="Less like this"
              >
                <span className="sr-only">Downvote</span>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          );
        }

        function Story({
          item,
          variant,
        }: {
          item: Item;
          variant: "featured" | "lead" | "mid" | "side" | "rest";
        }) {
          const isDimmed = item.read;
          const preview =
            item.news_item.content_preview ?? item.news_item.summary ?? item.news_item.title ?? "";

          const titleClass =
            variant === "featured"
              ? "font-serif text-3xl sm:text-4xl lg:text-5xl font-semibold leading-[1.02] tracking-tight"
              : variant === "lead"
                ? "font-serif text-2xl sm:text-3xl lg:text-3xl font-semibold leading-snug tracking-tight"
                : variant === "mid"
                  ? "font-serif text-base sm:text-lg font-semibold leading-snug tracking-tight"
                  : variant === "side"
                    ? "font-serif text-lg sm:text-xl font-semibold leading-snug tracking-tight"
                    : "font-serif text-sm sm:text-base font-semibold leading-snug tracking-tight";

          const excerptClass =
            variant === "featured"
              ? "text-base text-zinc-600 mt-2 line-clamp-5"
              : variant === "lead"
                ? "text-sm text-zinc-600 mt-2 line-clamp-6"
                : variant === "mid"
                  ? "text-sm text-zinc-600 mt-2 line-clamp-3"
                  : variant === "side"
                    ? "text-sm text-zinc-600 mt-2 line-clamp-4"
                    : "text-sm text-zinc-600 mt-2 line-clamp-2";

          const metaClass = variant === "featured" ? "text-sm" : "text-xs";

          return (
            <article
              className={`group flex gap-4 ${
                variant === "mid" ? "px-0" : "px-2"
              } ${
                variant === "featured"
                  ? "py-0.5"
                  : "py-4 pb-5 border-b border-zinc-200"
              } ${isDimmed ? "opacity-75" : "opacity-100"}`}
            >
              <div className="min-w-0 flex-1">
                <a
                  href={item.news_item.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => markRead(item.news_item_id)}
                  className="block"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    {!item.is_surprise && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-zinc-100 text-zinc-600">
                        #{item.rank}
                      </span>
                    )}
                    {item.is_surprise && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800">
                        Surprise
                      </span>
                    )}
                    {item.news_item.source_label && (
                      <span className={`${metaClass} text-zinc-500`}>{item.news_item.source_label}</span>
                    )}
                    {item.read && <span className={`${metaClass} text-zinc-400`}>Read</span>}
                  </div>

                  <h3 className={`${titleClass} text-zinc-900 mt-1.5`}>
                    {item.news_item.title}
                  </h3>

                  {variant === "rest" ? (
                    item.news_item.summary ? (
                      <p className={excerptClass}>{item.news_item.summary}</p>
                    ) : (
                      <p className={excerptClass}>{preview}</p>
                    )
                  ) : (
                    preview && <p className={excerptClass}>{preview}</p>
                  )}
                </a>
              </div>

              <div className="flex items-start pt-1 shrink-0">
                <Controls item={item} />
              </div>
            </article>
          );
        }

        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-6 items-start">
              <div className="lg:col-span-7 space-y-4">
                {featured ? <Story item={featured} variant="featured" /> : null}

                {lead.length > 0 && (
                  <div className="space-y-2">
                    {lead.map((item) => (
                      <Story key={item.id} item={item} variant="lead" />
                    ))}
                  </div>
                )}

                {mid.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-0 gap-y-4">
                    {mid.map((item, idx) => (
                      <div
                        key={item.id}
                        className={idx === 1 ? "border-l border-zinc-200 pl-6" : "pr-6"}
                      >
                        <Story item={item} variant="mid" />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <aside className="lg:col-span-5 space-y-6 border-l border-zinc-200 lg:pl-8">
                {rightTop ? <Story item={rightTop} variant="side" /> : null}

                {rightRest.length > 0 && (
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] gap-x-6 gap-y-6">
                    {rightRest.map((item) => (
                      <Story key={item.id} item={item} variant="rest" />
                    ))}
                  </div>
                )}
              </aside>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
