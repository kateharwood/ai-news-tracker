import Anthropic from "@anthropic-ai/sdk";
import { loadPrompt, substitutePrompt } from "./prompts";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY,
});

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const BACKUP_MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 1024;
const DEFAULT_429_DELAY_MS = 5000;
const MAX_429_DELAY_MS = 60_000;

function getRetryAfterMs(headers: Record<string, string> | undefined): number {
  if (!headers) return DEFAULT_429_DELAY_MS;
  const raw =
    (headers as Record<string, string | undefined>)["retry-after"] ??
    (headers as Record<string, string | undefined>)["Retry-After"];
  if (raw == null || raw === "") return DEFAULT_429_DELAY_MS;
  const sec = parseInt(raw, 10);
  if (!Number.isNaN(sec) && sec >= 0) {
    return Math.min(sec * 1000, MAX_429_DELAY_MS);
  }
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    const ms = Math.max(0, date.getTime() - Date.now());
    return Math.min(ms, MAX_429_DELAY_MS);
  }
  return DEFAULT_429_DELAY_MS;
}

async function createWithFallback(
  params: { model: string; max_tokens: number; messages: { role: "user"; content: string }[] }
) {
  try {
    return await client.messages.create({ ...params, model: params.model ?? MODEL });
  } catch (err: unknown) {
    const status = err && typeof err === "object" && "status" in err ? (err as { status: number }).status : 0;
    const headers =
      err && typeof err === "object" && "headers" in err
        ? (err as { headers?: Record<string, string> }).headers
        : undefined;

    if (status === 429) {
      const delayMs = getRetryAfterMs(headers);
      console.warn("[claude] Rate limited (429), retrying after", delayMs, "ms (Retry-After:", headers?.["retry-after"] ?? "none", ")");
      await new Promise((r) => setTimeout(r, delayMs));
      return await client.messages.create({ ...params, model: params.model ?? MODEL });
    }

    if (status === 404 && params.model !== BACKUP_MODEL) {
      console.warn("[claude] Model not found, retrying with backup:", BACKUP_MODEL);
      return await client.messages.create({ ...params, model: BACKUP_MODEL });
    }
    throw err;
  }
}

/** Exact user message sent to Claude for filter_item (same substitution as `filterItem`). */
export function buildFilterItemPrompt(
  preferencePrompt: string,
  title: string,
  rawContent: string,
  url: string
): string {
  const template = loadPrompt("filter_item");
  return substitutePrompt(template, {
    preference_prompt: preferencePrompt,
    title,
    raw_content: rawContent.slice(0, 4000),
    url: url || "",
  });
}

export async function filterItem(
  preferencePrompt: string,
  title: string,
  rawContent: string,
  url: string
): Promise<"INCLUDED" | "EXCLUDED"> {
  const text = buildFilterItemPrompt(preferencePrompt, title, rawContent, url);
  const res = await createWithFallback({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: text }],
  });
  const content = res.content[0];
  const body =
    content.type === "text" ? content.text : "";
  const upper = body.trim().toUpperCase();
  return upper.includes("INCLUDED") ? "INCLUDED" : "EXCLUDED";
}

export async function summarizeItem(title: string, rawContent: string): Promise<string> {
  const template = loadPrompt("summarize_item");
  const text = substitutePrompt(template, {
    title,
    raw_content: (rawContent || "").slice(0, 3000),
  });
  const res = await createWithFallback({
    model: MODEL,
    max_tokens: 256,
    messages: [{ role: "user", content: text }],
  });
  const content = res.content[0];
  return content.type === "text" ? content.text.trim() : "";
}

/** Exact user message sent to Claude for rank_top12 (same substitution as `rankTop12`). */
export function buildRankTop12Prompt(
  preferencePrompt: string,
  items: { id: string; title: string; summary: string | null; url: string | null }[]
): string {
  const itemsBlock = items
    .map(
      (i) =>
        `id: ${i.id}\ntitle: ${i.title}\nsummary: ${i.summary ?? ""}\nurl: ${i.url ?? ""}`
    )
    .join("\n\n");
  const template = loadPrompt("rank_top12");
  return substitutePrompt(template, {
    preference_prompt: preferencePrompt,
    items: itemsBlock,
  });
}

export async function rankTop12(
  preferencePrompt: string,
  items: { id: string; title: string; summary: string | null; url: string | null }[]
): Promise<{ news_item_id: string; rank: number }[]> {
  const text = buildRankTop12Prompt(preferencePrompt, items);
  const res = await createWithFallback({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: text }],
  });
  const content = res.content[0];
  const body = content.type === "text" ? content.text : "";
  const jsonMatch = body.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  const parsed = JSON.parse(jsonMatch[0]) as { news_item_id: string; rank: number }[];
  const sorted = [...parsed].sort((a, b) => a.rank - b.rank);
  return sorted.slice(0, 12);
}

export async function preferencesToBullets(
  votedItems: { title: string; summary: string | null; direction: string }[]
): Promise<string> {
  console.log("[preferences/LLM] preferencesToBullets: input", votedItems.length, "voted items → calling Claude");
  const lines = votedItems.map(
    (v) => `- ${v.direction}: ${v.title}${v.summary ? ` | ${v.summary}` : ""}`
  );
  const template = loadPrompt("preferences_to_bullets");
  const text = substitutePrompt(template, {
    voted_items: lines.join("\n"),
  });
  const res = await createWithFallback({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: text }],
  });
  const content = res.content[0];
  const out = content.type === "text" ? content.text.trim() : "";
  console.log("[preferences/LLM] preferencesToBullets: done → output", out.length, "chars");
  return out;
}

export async function condensePrompt(promptContent: string): Promise<string> {
  const inputWords = wordCount(promptContent);
  console.log("[preferences/LLM] condensePrompt: input", inputWords, "words → calling Claude to condense");
  const template = loadPrompt("condense_prompt");
  const text = substitutePrompt(template, { prompt_content: promptContent });
  const res = await createWithFallback({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: text }],
  });
  const content = res.content[0];
  const out = content.type === "text" ? content.text.trim() : "";
  const outputWords = wordCount(out);
  console.log("[preferences/LLM] condensePrompt: done → output", outputWords, "words (was", inputWords, ")");
  return out;
}

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}
