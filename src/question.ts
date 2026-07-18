/**
 * The structured clarifying-question block an agent can end a message with:
 *
 *   ```agent-question
 *   {"question": "Which nav style?", "options": ["Sidebar", "Top bar"]}
 *   ```
 *
 * When present and well-formed the block is lifted into a `QuestionSpec` and
 * stripped from the surrounding prose. A malformed block is left untouched as
 * plain text — showing the user a slightly raw message beats dropping it.
 *
 * The legacy `carve-question` fence is accepted during migration.
 */

export interface QuestionSpec {
  /** The clarifying question to put to the user. */
  question: string;
  /** Two or more short answer labels the user can pick from. */
  options: string[];
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
/** Defensive length ceilings, mirroring the controls schema's. Over-length
 * questions invalidate the block; over-length options are skipped. */
const MAX_QUESTION_LENGTH = 500;
const MAX_OPTION_LENGTH = 100;

/** Matches the first question fenced block. The info string must be exactly
 * the block name (optionally followed by trailing spaces) so plain ```json
 * blocks the agent emits for other reasons are ignored. */
const BLOCK_RE =
  /```(?:agent-question|carve-question)[^\S\r\n]*\r?\n([\s\S]*?)\r?\n?```/;

export function parseQuestionBlock(raw: string): ParsedQuestionText {
  const match = BLOCK_RE.exec(raw);
  if (!match) return { text: raw, question: null };

  const question = parseBlockBody(match[1] ?? "");
  if (!question) return { text: raw, question: null };

  // Removing the block from the middle of a message leaves the blank lines
  // that bracketed it stacked together — collapse those so the prose reads
  // naturally either side of the seam.
  const text = (raw.slice(0, match.index) + raw.slice(match.index + match[0].length))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, question };
}

function parseBlockBody(body: string): QuestionSpec | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.question !== "string") return null;
  const question = obj.question.trim();
  if (!question || question.length > MAX_QUESTION_LENGTH) return null;

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
  // A question needs at least two distinct choices to be worth a card — with
  // one (or none) the agent should just ask in plain text.
  if (options.length < 2) return null;

  return { question, options };
}
