import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { SourcesList } from "./sources-list";

export default async function SourcesPage() {
  const supabase = await createClient();
  const { data: sources } = await supabase
    .from("sources")
    .select("id, type, config, enabled, created_at")
    .order("created_at", { ascending: false });
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-zinc-900 mb-6">Sources</h1>
      <SourcesList initialSources={sources ?? []} />
    </div>
  );
}
