const DEFAULT_TZ = "America/New_York";

function resolveTimezone(): string {
  const candidate = process.env.APP_TIMEZONE?.trim() || DEFAULT_TZ;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_TZ;
  }
}

const TZ = resolveTimezone();

export function todayEastern(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

/** Format YYYY-MM-DD or ISO string as "March 14th, 2026" */
export function formatDisplayDate(ymdOrIso: string): string {
  const d = new Date(ymdOrIso + (ymdOrIso.length === 10 ? "T12:00:00" : ""));
  if (Number.isNaN(d.getTime())) return ymdOrIso;
  const month = d.toLocaleString("en-US", { month: "long" });
  const day = d.getDate();
  const year = d.getFullYear();
  const ord =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  return `${month} ${day}${ord}, ${year}`;
}

export function nowEastern(): Date {
  const str = new Date().toLocaleString("en-US", { timeZone: TZ });
  return new Date(str);
}

export function startOfTodayEastern(): Date {
  const d = nowEastern();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function last24hStart(): Date {
  const start = startOfTodayEastern();
  const now = nowEastern();
  const diff = now.getTime() - start.getTime();
  if (diff < 0) {
    start.setDate(start.getDate() - 1);
  }
  return start;
}

export function toISOSimple(d: Date): string {
  return d.toISOString();
}
