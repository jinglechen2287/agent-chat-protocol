/**
 * Chat-title text rules — the bounds and normalizations a title is subject to,
 * with no dependency on how one is generated.
 *
 * They live in the client-safe entry because both sides need them: the server
 * bounds what the model returns and what a host stores, and a client derives
 * the offline title it shows before the generator answers. A client that
 * re-implements the width instead drifts from the generated one, and its copy
 * collects fixes this one never sees.
 */

/** One side of a conversation, as the title model sees it. */
export interface ChatTitleMessage {
  role: "user" | "assistant";
  text: string;
}

/** Widest a chat title gets, in UTF-16 units. */
export const CHAT_TITLE_MAX_LENGTH = 60;
/** Widest an `overarchingTask` or `pivotCandidate` summary gets. */
export const CHAT_TITLE_TASK_MAX_LENGTH = 400;
/** Recent messages a host sends as title context unless it says otherwise. */
export const CHAT_TITLE_RECENT_MESSAGE_LIMIT = 12;

/**
 * Cuts to `max` UTF-16 units without splitting a surrogate pair: half an
 * emoji renders as a replacement glyph wherever the value is shown, and
 * survives into whatever the host persists.
 */
function truncateAt(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = max - 1;
  const lead = value.charCodeAt(cut - 1);
  const trail = value.charCodeAt(cut);
  const splitsPair =
    lead >= 0xd800 && lead <= 0xdbff && trail >= 0xdc00 && trail <= 0xdfff;
  return `${value.slice(0, splitsPair ? cut - 1 : cut).trimEnd()}…`;
}

/** Bounds a chat title to {@link CHAT_TITLE_MAX_LENGTH}. Exported so a host
 * deriving its own offline title (the first line of a message, say) lands on
 * the same width as a generated one instead of re-deriving the bound. */
export function truncateChatTitle(title: string): string {
  return truncateAt(title, CHAT_TITLE_MAX_LENGTH);
}

/**
 * Strip a wrapping markdown code fence, tolerating any info string
 * (```json, ```JSON, ```javascript), CRLF line endings, and a missing
 * newline before the closing fence. Internal: the generator uses it on model
 * output, and it is not part of the published surface.
 */
export function stripCodeFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```[^\n]*\r?\n?/, "")
    .replace(/\r?\n?```$/, "")
    .trim();
}

/** Reduces model or host text to a single bounded title line, or `undefined`
 * when nothing usable is left. */
export function normalizeChatTitle(raw: string): string | undefined {
  let title = stripCodeFence(raw);
  title = title.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  title = title.replace(/^title\s*:\s*/i, "").trim();
  const quotePairs: ReadonlyArray<readonly [string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["“", "”"],
  ];
  for (const [open, close] of quotePairs) {
    if (title.startsWith(open) && title.endsWith(close)) {
      title = title.slice(open.length, -close.length).trim();
      break;
    }
  }
  title = title.replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
  return title ? truncateChatTitle(title) : undefined;
}

/**
 * Bounds a task summary to {@link CHAT_TITLE_TASK_MAX_LENGTH}, collapsing
 * whitespace and reporting an empty one as absent. Exported because a host
 * that stores the generator's task state has to bound it the same way on the
 * way in — the prompt budgets against this length, so a host that invents its
 * own can quietly feed back more context than the generator planned for.
 */
export function normalizeTaskSummary(raw: string): string | undefined {
  const summary = raw.trim().replace(/\s+/g, " ");
  if (!summary) return undefined;
  return truncateAt(summary, CHAT_TITLE_TASK_MAX_LENGTH);
}

/** The title shown before (or instead of) a generated one: the first non-empty
 * line of the request, an image name, or a constant. */
export function fallbackChatTitle(
  prompt: string,
  attachmentNames: readonly string[] = [],
): string {
  const firstLine = prompt.split("\n").map((line) => line.trim()).find(Boolean);
  if (firstLine) return truncateChatTitle(firstLine);
  return attachmentNames[0]
    ? truncateChatTitle(`Image: ${attachmentNames[0]}`)
    : "New thread";
}

/**
 * Projects a host's transcript onto the `recentMessages` title context: the
 * last `limit` messages that carry text, oldest first, with every non-user
 * role folded into `assistant`.
 *
 * Hosts model a transcript differently (questions, plans, tool activity), but
 * the title model only cares who was speaking, so the fold belongs here rather
 * than in each host. Callers with pre-shaped `{role, text}` pairs pass them
 * directly; callers with their own message kinds pass a `project` picker that
 * returns the `{role, text}` a message contributes — a plan its markdown, say
 * — or `null` for one that carries no topic signal. Declined rows don't count
 * against the window and the walk stops as soon as it fills, so an
 * arbitrarily long run of tool rows neither starves the window nor costs
 * allocations.
 */
export function toChatTitleMessages(
  messages: readonly { role: string; text: string }[],
  limit?: number,
): ChatTitleMessage[];
export function toChatTitleMessages<T>(
  messages: readonly T[],
  limit: number | undefined,
  project: (message: T) => { role: string; text: string } | null,
): ChatTitleMessage[];
export function toChatTitleMessages<T>(
  messages: readonly T[],
  limit: number = CHAT_TITLE_RECENT_MESSAGE_LIMIT,
  project?: (message: T) => { role: string; text: string } | null,
): ChatTitleMessage[] {
  const recent: ChatTitleMessage[] = [];
  for (let index = messages.length - 1; index >= 0 && recent.length < limit; index -= 1) {
    const raw = messages[index];
    if (raw === undefined || raw === null) continue;
    // Safe cast: the no-picker overload only admits {role, text} elements.
    const message = project
      ? project(raw)
      : (raw as unknown as { role: string; text: string });
    if (!message || message.text.trim() === "") continue;
    recent.push({
      role: message.role === "user" ? "user" : "assistant",
      text: message.text,
    });
  }
  return recent.reverse();
}
