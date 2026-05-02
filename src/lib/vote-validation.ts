export type VoteParseResult =
  | { ok: true; news_item_id: string; direction: "up" | "down" }
  | { ok: false };

export function parseVoteBody(body: unknown): VoteParseResult {
  if (!body || typeof body !== "object") return { ok: false };
  const news_item_id = (body as { news_item_id?: unknown }).news_item_id;
  const direction = (body as { direction?: unknown }).direction;
  if (typeof news_item_id !== "string" || news_item_id.length === 0) return { ok: false };
  if (direction !== "up" && direction !== "down") return { ok: false };
  return { ok: true, news_item_id, direction };
}
