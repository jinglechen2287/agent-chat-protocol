/**
 * The structured clarifying-question block an agent can end a message with:
 *
 *   ```agent-question
 *   {"question": "Which nav style?", "options": ["Sidebar", "Top bar"]}
 *   ```
 *
 * or, to ask several things at once, a list of them — each may set
 * `"multi": true` to take more than one option:
 *
 *   ```agent-question
 *   {"questions": [
 *     {"question": "Which nav style?", "options": ["Sidebar", "Top bar"]},
 *     {"question": "Which pages?", "options": ["Home", "Docs"], "multi": true}
 *   ]}
 *   ```
 *
 * When present and well-formed the block is lifted into a `QuestionSpec` and
 * stripped from the surrounding prose. A malformed block is left untouched as
 * plain text — showing the user a slightly raw message beats dropping it.
 *
 * The legacy `carve-question` fence is accepted during migration.
 */

import { extractBlock, fencedPatternFinder } from "./block";
import { isRecord } from "./guards";
import { LEGACY_QUESTION_BLOCK_NAME, QUESTION_BLOCK_NAME } from "./prompt";

/** One question: what to ask and the labels the user can pick from. */
export interface QuestionItem {
  /** The clarifying question to put to the user. */
  question: string;
  /** One or more short answer labels the user can pick from. */
  options: string[];
  /** The user may pick more than one option. Absent means one. */
  multi?: boolean;
}

/**
 * A parsed question block. `question`, `options` and `multi` are always its
 * first question, so a client that knows only one question per card still
 * renders something sensible. `questions` is present only when the card is a
 * form the user fills in and then sends — more than one question, or any
 * multi-select one — and holds every question, the first included. Without it
 * the card is the one-tap kind: the picked label is the whole reply.
 */
export interface QuestionSpec extends QuestionItem {
  questions?: QuestionItem[];
}

export interface ParsedQuestionText {
  /** The message text with a valid question block removed and trimmed. Empty
   * string when the message was nothing but the block. */
  text: string;
  /** The parsed question, or null when the message had no valid block. */
  question: QuestionSpec | null;
}

/** Upper bound on rendered option chips — the agent is asked for 2–6; this is
 * a defensive ceiling so a runaway block can't flood the client. */
const MAX_OPTIONS = 8;
/** Defensive length ceilings against a runaway block, not a style rule: an option that explains itself in a sentence or two still renders, since cards wrap long labels. Over-length questions invalidate the block; over-length options are skipped. */
const MAX_QUESTION_LENGTH = 500;
const MAX_OPTION_LENGTH = 500;

const findBlock = fencedPatternFinder([QUESTION_BLOCK_NAME, LEGACY_QUESTION_BLOCK_NAME], "inline");

export function parseQuestionBlock(raw: string): ParsedQuestionText {
  const { text, value } = extractBlock(raw, findBlock, parseBlockBody);
  return { text, question: value };
}

function parseBlockBody(body: string): QuestionSpec | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.trim());
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const obj = parsed;
  const raw = "questions" in obj ? obj.questions : [obj];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const items: QuestionItem[] = [];
  for (const entry of raw) {
    // Any bad question spoils the block: dropping one silently would leave
    // the agent waiting on an answer the user was never asked for.
    const item = parseItem(entry);
    if (!item) return null;
    items.push(item);
  }
  const [first, ...rest] = items as [QuestionItem, ...QuestionItem[]];
  const form = rest.length > 0 || first.multi === true;
  return form ? { ...first, questions: items } : first;
}

function parseItem(entry: unknown): QuestionItem | null {
  if (!isRecord(entry)) return null;
  const obj = entry;
  if (typeof obj.question !== "string") return null;
  const question = obj.question.trim();
  if (!question || question.length > MAX_QUESTION_LENGTH) return null;
  if (obj.multi !== undefined && typeof obj.multi !== "boolean") return null;

  if (!Array.isArray(obj.options)) return null;
  const options: string[] = [];
  const seen = new Set<string>();
  for (const opt of obj.options) {
    if (typeof opt !== "string") continue;
    const trimmed = opt.trim();
    if (trimmed && trimmed.length <= MAX_OPTION_LENGTH && !seen.has(trimmed)) {
      seen.add(trimmed);
      options.push(trimmed);
    }
    if (options.length >= MAX_OPTIONS) break;
  }
  // One option is worth a card: it can offer a single next step, and a typed
  // reply is always the other answer. With none, the block isn't a question.
  if (options.length < 1) return null;

  return obj.multi === true ? { question, options, multi: true } : { question, options };
}

/** Text on one line: line breaks and runs of spaces become one space. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * A form card's reply, as the next user turn: one numbered line per question,
 * `1. Question → Answer`, several answers joined by `; `, and `(skipped)` for
 * a question left unanswered. `answers[i]` holds question `i`'s picked labels
 * and any typed text; blank ones are dropped.
 */
export function formatQuestionAnswers(items: readonly QuestionItem[], answers: readonly (readonly string[])[]): string {
  return items
    .map((item, index) => {
      const picked = (answers[index] ?? []).map(oneLine).filter(Boolean);
      return `${index + 1}. ${oneLine(item.question)} → ${picked.length > 0 ? picked.join("; ") : "(skipped)"}`;
    })
    .join("\n");
}
