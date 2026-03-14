import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  preferencesToBullets,
  condensePrompt,
  wordCount,
} from "@/lib/claude";

const PREFERENCE_PROMPT_ID = "00000000-0000-0000-0000-000000000001";
const VOTES_BATCH = 10;

/** Run only when there are 10+ new votes since last run (overall count in DB, not session). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const service = createServiceRoleClient();

  const { data: lastRun } = await service
    .from("preference_bullet_runs")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const since = lastRun?.created_at ?? "1970-01-01T00:00:00Z";

  /* Overall new vote count: all votes with created_at > last run (can span days). */
  const { data: votesSinceRun } = await service
    .from("votes")
    .select("news_item_id, direction, created_at")
    .eq("user_id", user.id)
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(VOTES_BATCH * 2);
  let recentVotes = (votesSinceRun || []).slice(0, VOTES_BATCH);

  if (recentVotes.length < VOTES_BATCH) {
    if (!lastRun) {
      const { data: allVotes } = await service
        .from("votes")
        .select("news_item_id, direction, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(VOTES_BATCH);
      if ((allVotes?.length ?? 0) >= VOTES_BATCH) {
        recentVotes = (allVotes || []).slice(0, VOTES_BATCH);
        console.log("[run-preferences] First run: using 10 most recent votes");
      }
    }
    if (recentVotes.length < VOTES_BATCH) {
      console.log("[run-preferences] Skipping: need", VOTES_BATCH, "votes since last run; have", recentVotes.length);
      return NextResponse.json({
        ok: true,
        ran: false,
        message: `Need ${VOTES_BATCH} new votes since last run; have ${recentVotes.length}.`,
      });
    }
  }

  const newsIds = Array.from(new Set(recentVotes.map((v) => v.news_item_id)));
  const { data: newsItems } = await service
    .from("news_items")
    .select("id, title, summary")
    .in("id", newsIds);
  const newsMap = new Map((newsItems || []).map((n) => [n.id, n]));

  const votedItems = recentVotes.map((v) => {
    const n = newsMap.get(v.news_item_id);
    return {
      title: n?.title ?? "",
      summary: n?.summary ?? null,
      direction: v.direction,
    };
  });

  console.log("[run-preferences] Running: processing", recentVotes.length, "votes into preference bullets");
  const bullets = await preferencesToBullets(votedItems);

  const { data: promptRow } = await service
    .from("preference_prompt")
    .select("content, word_count")
    .eq("id", PREFERENCE_PROMPT_ID)
    .single();
  let newContent = (promptRow?.content ?? "") + "\n\n" + bullets;
  let newWordCount = wordCount(newContent);

  if (newWordCount > 500) {
    newContent = await condensePrompt(newContent);
    newWordCount = wordCount(newContent);
  }

  await service
    .from("preference_prompt")
    .update({
      content: newContent,
      word_count: newWordCount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", PREFERENCE_PROMPT_ID);
  await service.from("preference_bullet_runs").insert({
    votes_processed: recentVotes.length,
    bullets_appended: bullets,
  });

  console.log("[run-preferences] Done: appended bullets, word_count:", newWordCount);
  return NextResponse.json({
    ok: true,
    ran: true,
    word_count: newWordCount,
  });
}
