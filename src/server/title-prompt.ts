/**
 * Prompt plumbing both title generators share: escaping untrusted text into
 * XML-delimited sections under a budget, and reading the model's JSON back.
 * Internal: not re-exported from the server entry.
 */
import type { ChatTitleMessage } from "../title-text.js";
import { stripCodeFence } from "../title-text.js";

/** Default wall-clock limit for one title run. */
export const DEFAULT_TITLE_TIMEOUT_MS = 10_000;
/** Default budget for the untrusted text a title prompt carries. */
export const DEFAULT_TITLE_MAX_INPUT_CHARS = 4_000;

function escapePromptData(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Inverse of escapePromptData for model output that echoes escaped context;
// decode &amp; last so a double-escaped "&amp;lt;" round-trips to "&lt;"
// instead of collapsing to "<".
export function decodePromptData(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Escaping never shrinks a string, so the first `budget` escaped chars come
// from at most the first `budget` input chars — escape only that slice
// (O(budget) instead of O(input)). A trailing bare "&" run can only be a cut
// entity, because a raw "&" always escapes to "&amp;", so strip it after the
// final slice.
export function escapeBounded(raw: string, budget: number): string {
  if (budget <= 0) return "";
  return escapePromptData(raw.slice(0, budget))
    .slice(0, budget)
    .replace(/&[a-z]{0,3}$/, "");
}

/**
 * Role-tagged messages, newest kept first, within `budget` chars. XML-style
 * role markers cannot be forged from message text because its "<" and ">"
 * are escaped. Returns the joined text and the chars it used.
 */
export function boundRecentMessages(
  messages: readonly ChatTitleMessage[],
  budget: number,
): { text: string; used: number } {
  let remaining = budget;
  const parts: string[] = [];
  for (let index = messages.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const separatorLength = parts.length ? 1 : 0;
    const open = `<${message.role}>`;
    const close = `</${message.role}>`;
    const textBudget = remaining - separatorLength - open.length - close.length - 2;
    if (textBudget <= 0) break;
    const text = escapeBounded(message.text, textBudget);
    if (!text) continue;
    const part = `${open}\n${text}\n${close}`;
    parts.unshift(part);
    remaining -= part.length + separatorLength;
  }
  return { text: parts.join("\n"), used: budget - remaining };
}

/** The model's JSON reply, tolerating a code fence or surrounding prose;
 * `undefined` when no object parses. */
export function parseJsonObject(raw: string): unknown {
  const json = stripCodeFence(raw);
  try {
    return JSON.parse(json);
  } catch {
    // Salvage a JSON object embedded in surrounding prose.
    const start = json.indexOf("{");
    const end = json.lastIndexOf("}");
    if (start === -1 || end <= start) return undefined;
    try {
      return JSON.parse(json.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}
