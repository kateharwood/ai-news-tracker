import { todayEastern, formatDisplayDate } from "@/lib/time";
import { RankingsList } from "./rankings-list";
import { RunDailyJobButton } from "./run-daily-job-button";

export default async function DashboardPage() {
  const date = todayEastern();
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">
          Today’s Top 10
          <span className="text-zinc-500 font-normal ml-2">{formatDisplayDate(date)}</span>
        </h1>
        <RunDailyJobButton />
      </div>
      <RankingsList date={date} />
    </div>
  );
}
