"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PhaseResult = {
  ingested: number;
  filtered: number;
  ranked: number;
  skipped_stale?: number;
  error?: string;
};

export function RunDailyJobButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PhaseResult | null>(null);
  const router = useRouter();

  async function runJob() {
    setLoading(true);
    setResult(null);
    try {
      const res1 = await fetch("/api/run/ingest", { method: "POST" });
      const d1 = await res1.json();
      if (!res1.ok || d1.error) {
        setResult({
          ingested: typeof d1.ingested === "number" ? d1.ingested : 0,
          filtered: 0,
          ranked: 0,
          error: d1.error ?? (res1.ok ? "Ingest failed" : "Request failed"),
        });
        return;
      }

      const res2 = await fetch("/api/run/filter", { method: "POST" });
      const d2 = await res2.json();
      if (!res2.ok || d2.error) {
        setResult({
          ingested: d1.ingested ?? 0,
          filtered: typeof d2.filtered === "number" ? d2.filtered : 0,
          ranked: 0,
          skipped_stale: d2.skipped_stale,
          error: d2.error ?? (res2.ok ? "Filter failed" : "Request failed"),
        });
        return;
      }

      const res3 = await fetch("/api/run/rank", { method: "POST" });
      const d3 = await res3.json();
      if (!res3.ok || d3.error) {
        setResult({
          ingested: d1.ingested ?? 0,
          filtered: d2.filtered ?? 0,
          ranked: 0,
          skipped_stale: d2.skipped_stale,
          error: d3.error ?? (res3.ok ? "Rank failed" : "Request failed"),
        });
        return;
      }

      setResult({
        ingested: d1.ingested ?? 0,
        filtered: d2.filtered ?? 0,
        ranked: d3.ranked ?? 0,
        skipped_stale: d2.skipped_stale,
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={runJob}
        disabled={loading}
        className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
      >
        {loading ? (
          <>
            <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Running…
          </>
        ) : (
          <>Fetch & rank news</>
        )}
      </button>
      {result && (
        <div
          className={`text-xs text-right ${
            result.error ? "text-red-600" : "text-zinc-500"
          }`}
        >
          {result.error ? (
            result.error
          ) : (
            <>
              Ingested {result.ingested} · Included {result.filtered} · Ranked{" "}
              {result.ranked}
              {typeof result.skipped_stale === "number" && result.skipped_stale > 0
                ? ` · Skipped stale ${result.skipped_stale}`
                : ""}
            </>
          )}
        </div>
      )}
    </div>
  );
}
