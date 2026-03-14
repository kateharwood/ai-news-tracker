"use client";

import { useEffect, useState } from "react";

interface Item {
  id: string;
  rank: number;
  date: string;
  news_item_id: string;
  news_item: {
    id: string;
    title: string;
    summary: string | null;
    url: string | null;
  };
  vote: "up" | "down" | null;
  read: boolean;
}

export function RankingsList({ date }: { date: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [hideRead, setHideRead] = useState(false);
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

  const filtered = hideRead ? items.filter((i) => !i.read) : items;

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
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-zinc-600 cursor-pointer">
        <input
          type="checkbox"
          checked={hideRead}
          onChange={(e) => setHideRead(e.target.checked)}
          className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
        />
        Hide read items
      </label>
      <ol className="space-y-3 list-none">
        {filtered.map((item) => (
          <li
            key={item.id}
            className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-opacity ${
              item.read ? "opacity-75 border-zinc-200" : "border-zinc-200"
            }`}
          >
            <div className="p-4 flex items-start gap-4">
              <span className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 text-sm font-medium">
                {item.rank}
              </span>
              <div className="min-w-0 flex-1">
                <a
                  href={item.news_item.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => markRead(item.news_item_id)}
                  className="font-medium text-zinc-900 hover:text-blue-600 transition-colors block leading-snug"
                >
                  {item.news_item.title}
                </a>
                {item.news_item.summary && (
                  <p className="text-sm text-zinc-500 mt-1.5 line-clamp-2">
                    {item.news_item.summary}
                  </p>
                )}
                {item.read && (
                  <span className="inline-block mt-2 text-xs text-zinc-400">
                    Read
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
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
                    <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
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
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
