"use client";

import { useEffect, useState } from "react";

const INGEST_ERROR_STREAK_RED = 5;
/** Two or more long/timeout fetches in 48h also triggers red row. */
const LONG_FETCH_EVENTS_RED = 2;
const INGEST_HEALTH_48H_MS = 48 * 60 * 60 * 1000;

type SourceRow = {
  id: string;
  type: string;
  config: { url?: string; category?: string; keyword?: string };
  enabled: boolean;
  created_at: string;
  ingest_failure_streak?: number;
  last_ingest_attempt_at?: string | null;
  ingest_long_fetch_timestamps?: string[] | null;
};

function longFetchCount48h(timestamps: string[] | null | undefined, nowMs: number): number {
  if (!timestamps?.length) return 0;
  const cutoff = nowMs - INGEST_HEALTH_48H_MS;
  return timestamps.filter((t) => {
    const ms = new Date(t).getTime();
    return !Number.isNaN(ms) && ms >= cutoff;
  }).length;
}

/** Ingest has not started this feed in 48h while enabled (often starvation when ingest times out early). */
function isIngestStarved(s: SourceRow, nowMs: number): boolean {
  if (!s.enabled) return false;
  const createdMs = new Date(s.created_at).getTime();
  if (Number.isNaN(createdMs)) return false;
  const lastMs = s.last_ingest_attempt_at ? new Date(s.last_ingest_attempt_at).getTime() : NaN;
  if (Number.isNaN(lastMs)) {
    return nowMs - createdMs >= INGEST_HEALTH_48H_MS;
  }
  return nowMs - lastMs >= INGEST_HEALTH_48H_MS;
}

type SourceStats = {
  upvotes: number;
  downvotes: number;
  top10Appearances: number;
  filteredCountAllTime: number;
  avgFilteredPerDay: number;
};

export function SourcesList({
  initialSources,
  initialStaleSourceIds,
  initialSourceStats,
}: {
  initialSources: SourceRow[];
  initialStaleSourceIds: string[];
  initialSourceStats: Record<string, SourceStats>;
}) {
  const [sources, setSources] = useState(initialSources);
  const [staleIds, setStaleIds] = useState(() => new Set(initialStaleSourceIds));
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ url: "" });

  async function addSource() {
    const res = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "rss", config: { url: form.url } }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "Failed to add source");
      return;
    }
    const newSource = await res.json();
    setSources((prev) => [newSource, ...prev]);
    setAdding(false);
    setForm({ url: "" });
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

  function statsFor(sourceId: string): SourceStats {
    return (
      initialSourceStats[sourceId] ?? {
        upvotes: 0,
        downvotes: 0,
        top10Appearances: 0,
        filteredCountAllTime: 0,
        avgFilteredPerDay: 0,
      }
    );
  }

  /**
   * (up − down + top10) ÷ avg filters/day since the source was added.
   * Uses server-computed avg so older and newer feeds are comparable.
   */
  function sourceEngagementScore(stats: SourceStats): number {
    const denom = stats.avgFilteredPerDay;
    if (denom <= 0) return Number.NEGATIVE_INFINITY;
    return (stats.upvotes - stats.downvotes + stats.top10Appearances) / denom;
  }

  const sortedSources = [...sources].sort((a, b) => {
    const aStats = statsFor(a.id);
    const bStats = statsFor(b.id);
    const aScore = sourceEngagementScore(aStats);
    const bScore = sourceEngagementScore(bStats);
    if (aScore !== bScore) return bScore - aScore;
    return a.created_at < b.created_at ? 1 : -1;
  });

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
            <label className="block text-sm font-medium text-zinc-700 mb-1">Feed URL</label>
            <input
              type="url"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://..."
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-zinc-800 placeholder-zinc-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <button
            type="button"
            onClick={addSource}
            disabled={!form.url.trim()}
            className="px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            Add
          </button>
        </div>
      )}
      <ul className="space-y-2">
        {sortedSources.map((s) => {
          const config = s.config as { url?: string; category?: string; keyword?: string };
          const stats = statsFor(s.id);
          const nowMs = Date.now();
          const label =
            s.type === "rss" && config.url
              ? (() => {
                  try {
                    return new URL(config.url.trim()).hostname;
                  } catch {
                    return config.url;
                  }
                })()
              : s.type;
          const isStale = staleIds.has(s.id);
          const streak = s.ingest_failure_streak ?? 0;
          const longFetch48h = longFetchCount48h(s.ingest_long_fetch_timestamps, nowMs);
          const isIngestRed = streak >= INGEST_ERROR_STREAK_RED || longFetch48h >= LONG_FETCH_EVENTS_RED;
          const isStarved = !isIngestRed && isIngestStarved(s, nowMs);
          const sortScore = sourceEngagementScore(stats);
          const rowClass = isIngestRed
            ? "bg-red-50/90 border-red-400 ring-1 ring-red-200/70"
            : isStarved
              ? "bg-yellow-50/90 border-yellow-400 ring-1 ring-yellow-200/70"
              : isStale
                ? "bg-orange-50/80 border-orange-300 ring-1 ring-orange-200/60"
                : "bg-white border-zinc-200";
          const redParts: string[] = [];
          if (streak >= INGEST_ERROR_STREAK_RED) {
            redParts.push(`failed ${streak}× in a row`);
          }
          if (longFetch48h >= LONG_FETCH_EVENTS_RED) {
            redParts.push(`${longFetch48h} slow/timeout fetch${longFetch48h === 1 ? "" : "es"} (48h)`);
          }
          const redLabel = redParts.length ? `Ingest: ${redParts.join(" · ")}` : "";
          return (
            <li
              key={s.id}
              className={`rounded-xl p-4 flex items-center justify-between gap-4 shadow-sm border ${rowClass}`}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-zinc-800 capitalize flex flex-wrap items-center gap-2">
                  RSS
                  <span className="text-zinc-600 font-normal">{label}</span>
                  {isIngestRed && (
                    <span className="text-xs font-medium text-red-800 bg-red-100 px-2 py-0.5 rounded">
                      {redLabel}
                    </span>
                  )}
                  {isStarved && (
                    <span className="text-xs font-medium text-yellow-900 bg-yellow-100 px-2 py-0.5 rounded">
                      No ingest attempt in 48h (may be starved behind slower feeds)
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
                <p className="text-xs text-zinc-500 mt-1">
                  Upvotes: {stats.upvotes} · Downvotes: {stats.downvotes} · Top 10 appearances:{" "}
                  {stats.top10Appearances} · Filtered (all time): {stats.filteredCountAllTime} (~
                  {stats.avgFilteredPerDay.toFixed(1)}/day since added)
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  (up − down + top 10) ÷ filtered/day (since added):{" "}
                  {sortScore === Number.NEGATIVE_INFINITY ? "—" : sortScore.toFixed(2)}
                </p>
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
        <p className="text-zinc-500 text-sm">No sources yet. Add an RSS feed.</p>
      )}
    </div>
  );
}
