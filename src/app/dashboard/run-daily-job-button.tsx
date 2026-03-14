"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RunDailyJobButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    ingested: number;
    filtered: number;
    ranked: number;
    error?: string;
  } | null>(null);
  const router = useRouter();

  async function runJob() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/cron/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setResult({
          ingested: 0,
          filtered: 0,
          ranked: 0,
          error: data.error ?? "Request failed",
        });
        return;
      }
      setResult(data);
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
