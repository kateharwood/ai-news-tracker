"use client";

import { useEffect, useState } from "react";
import { ARXIV_CATEGORIES } from "@/lib/types";

const INGEST_ERROR_STREAK_RED = 5;

type SourceRow = {
  id: string;
  type: string;
  config: { url?: string; category?: string; keyword?: string };
  enabled: boolean;
  created_at: string;
  ingest_failure_streak?: number;
};

export function SourcesList({
  initialSources,
  initialStaleSourceIds,
}: {
  initialSources: SourceRow[];
  initialStaleSourceIds: string[];
}) {
  const [sources, setSources] = useState(initialSources);
  const [staleIds, setStaleIds] = useState(() => new Set(initialStaleSourceIds));
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    type: "rss" as "rss" | "arxiv",
    url: "",
    category: "cs.AI",
    keyword: "",
  });

  async function addSource() {
    const config =
      form.type === "rss"
        ? { url: form.url }
        : { category: form.category, keyword: form.keyword || undefined };
    const res = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: form.type, config }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "Failed to add source");
      return;
    }
    const newSource = await res.json();
    setSources((prev) => [newSource, ...prev]);
    setAdding(false);
    setForm({ type: "rss", url: "", category: "cs.AI", keyword: "" });
  }

  async function deleteSource(id: string) {
    if (!confirm("Remove this source?")) return;
    const res = await fetch(`/api/sources?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setSources((prev) => prev.filter((s) => s.id !== id));
      setStaleIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // Keep the orange highlight state in sync with server recalculation
  // (e.g. after manual "Fetch & rank news" where we call router.refresh()).
  useEffect(() => {
    setStaleIds(new Set(initialStaleSourceIds));
  }, [initialStaleSourceIds]);

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => setAdding(!adding)}
        className="px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
      >
        {adding ? "Cancel" : "Add source"}
      </button>
      {adding && (
        <div className="bg-white border border-zinc-200 rounded-xl p-5 space-y-4 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Type</label>
            <select
              value={form.type}
              onChange={(e) =>
                setForm((f) => ({ ...f, type: e.target.value as "rss" | "arxiv" }))
              }
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-zinc-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="rss">RSS feed</option>
              <option value="arxiv">arXiv</option>
            </select>
          </div>
          {form.type === "rss" && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Feed URL</label>
              <input
                type="url"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://..."
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-zinc-800 placeholder-zinc-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          )}
          {form.type === "arxiv" && (
            <>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, category: e.target.value }))
                  }
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-zinc-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {ARXIV_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Keyword filter (optional)
                </label>
                <input
                  type="text"
                  value={form.keyword}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, keyword: e.target.value }))
                  }
                  placeholder="e.g. diffusion"
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-zinc-800 placeholder-zinc-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </>
          )}
          <button
            type="button"
            onClick={addSource}
            disabled={form.type === "rss" && !form.url.trim()}
            className="px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            Add
          </button>
        </div>
      )}
      <ul className="space-y-2">
        {sources.map((s) => {
          const config = s.config as { url?: string; category?: string; keyword?: string };
          const label =
            s.type === "rss" && config.url
              ? (() => {
                  try {
                    return new URL(config.url.trim()).hostname;
                  } catch {
                    return config.url;
                  }
                })()
              : s.type === "arxiv"
                ? `${config.category ?? ""}${config.keyword ? ` + ${config.keyword}` : ""}`
                : s.type;
          const isStale = staleIds.has(s.id);
          const streak = s.ingest_failure_streak ?? 0;
          const isIngestError = streak >= INGEST_ERROR_STREAK_RED;
          const rowClass = isIngestError
            ? "bg-red-50/90 border-red-400 ring-1 ring-red-200/70"
            : isStale
              ? "bg-orange-50/80 border-orange-300 ring-1 ring-orange-200/60"
              : "bg-white border-zinc-200";
          return (
            <li
              key={s.id}
              className={`rounded-xl p-4 flex items-center justify-between gap-4 shadow-sm border ${rowClass}`}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-zinc-800 capitalize flex flex-wrap items-center gap-2">
                  {s.type === "rss" ? "RSS" : "arXiv"}
                  <span className="text-zinc-600 font-normal">{label}</span>
                  {isIngestError && (
                    <span className="text-xs font-medium text-red-800 bg-red-100 px-2 py-0.5 rounded">
                      Ingest failed {streak}× in a row
                    </span>
                  )}
                </div>
                {s.type === "rss" && config.url && (
                  <p
                    className="text-sm text-zinc-500 mt-1 truncate"
                    title={config.url}
                  >
                    {config.url}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => deleteSource(s.id)}
                className="text-sm text-red-600 hover:text-red-700 font-medium shrink-0"
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      {sources.length === 0 && !adding && (
        <p className="text-zinc-500 text-sm">No sources yet. Add an RSS feed or arXiv category.</p>
      )}
    </div>
  );
}
