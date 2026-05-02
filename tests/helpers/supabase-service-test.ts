import { createQueueSupabaseClient } from "./supabase-queue-mock";

export function createServiceRoleClient() {
  return createQueueSupabaseClient();
}
