import { http, HttpResponse } from "msw";

const ANTHROPIC_MESSAGES = "https://api.anthropic.com/v1/messages";

/**
 * Each POST to Anthropic messages API consumes the next reply string (assistant text).
 */
export function anthropicSequentialHandler(getReplies: () => string[]) {
  let idx = 0;

  const handler = http.post(ANTHROPIC_MESSAGES, async ({ request }) => {
    const replies = getReplies();
    const reqJson = (await request.json()) as { model?: string };
    const text = replies[idx] ?? "EXCLUDED";
    idx++;
    const body = {
      id: `msg_${idx}`,
      type: "message",
      role: "assistant",
      model: String(reqJson.model ?? "claude"),
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 2 },
    };
    return HttpResponse.json(body);
  });

  return {
    handler,
    resetSequentialIndex() {
      idx = 0;
    },
  };
}
