"use client";

import { useState } from "react";
import { RankingsList } from "../dashboard/rankings-list";
import { formatDisplayDate } from "@/lib/time";

export default function HistoryPage() {
  const [date, setDate] = useState("");
  const [showDate, setShowDate] = useState<string | null>(null);

  const today = new Date().toLocaleDateString("en-CA");
  const yesterday = new Date(Date.now() - 864e5).toLocaleDateString("en-CA");

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-semibold text-zinc-900 mb-6">History</h1>
      <div className="flex flex-wrap items-center gap-3 mb-8">
        <button
          type="button"
          onClick={() => setShowDate(today)}
          className="px-4 py-2.5 bg-white border border-zinc-200 rounded-lg text-zinc-700 text-sm font-medium hover:bg-zinc-50 shadow-sm transition-colors"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => setShowDate(yesterday)}
          className="px-4 py-2.5 bg-white border border-zinc-200 rounded-lg text-zinc-700 text-sm font-medium hover:bg-zinc-50 shadow-sm transition-colors"
        >
          Yesterday
        </button>
        <div className="flex items-center gap-2">
          <label htmlFor="date-picker" className="text-sm text-zinc-600">
            Pick date:
          </label>
          <input
            id="date-picker"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <button
            type="button"
            onClick={() => date && setShowDate(date)}
            className="px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Go
          </button>
        </div>
      </div>
      {showDate && (
        <div>
          <h2 className="text-lg font-medium text-zinc-700 mb-4">
            {formatDisplayDate(showDate)}
          </h2>
          <RankingsList date={showDate} />
        </div>
      )}
    </div>
  );
}
