/**
 * Cron routes: when CRON_SECRET is unset, requests are allowed (local dev).
 * When set, require `Authorization: Bearer <CRON_SECRET>`.
 */
export function isCronAuthorized(authHeader: string | null, cronSecret: string | undefined): boolean {
  if (!cronSecret) return true;
  return authHeader === `Bearer ${cronSecret}`;
}
