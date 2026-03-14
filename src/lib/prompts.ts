import { readFileSync } from "fs";
import path from "path";

const PROMPTS_DIR = path.join(process.cwd(), "prompts");

export function loadPrompt(name: string): string {
  const file = path.join(PROMPTS_DIR, `${name}.txt`);
  return readFileSync(file, "utf-8");
}

export function substitutePrompt(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replace(new RegExp(`{{${key}}}`, "g"), value ?? "");
  }
  return out;
}
