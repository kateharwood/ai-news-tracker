/**
 * Safe defaults when keys are absent (CI / local Vitest runs).
 * Real values in the shell are preserved (no forced override).
 */
if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_API_KEY) {
  process.env.ANTHROPIC_API_KEY = "vitest-ant-placeholder-not-for-production";
}
