import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client for cron / server jobs.
 * Must use cache: 'no-store' — Next.js App Router otherwise caches Supabase GET
 * selects, which made the filter cron keep reprocessing a stale pending queue
 * for weeks (same July stories every hour).
 */
export function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, cache: "no-store" }),
      },
    }
  );
}
