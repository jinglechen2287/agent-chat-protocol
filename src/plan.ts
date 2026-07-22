/**
 * The proposed-plan block a plan-mode agent ends its final message with:
 *
 *   <proposed_plan>
 *   # Add subtract to a.ts
 *   ...markdown...
 *   </proposed_plan>
 *
 * When present and well-formed the block is lifted into a `PlanSpec` and
 * stripped from the surrounding prose. A malformed or unclosed block is left
 * untouched as plain text — a raw plan in the transcript beats dropping it.
 *
 * Tags, not a fenced block, deliberately: plan markdown legitimately contains
 * code fences, and an inner ``` would close an outer fence. XML-ish tags have
 * no such collision, stream invisibly through markdown renderers that drop
 * unknown HTML, and match the `<proposed_plan>` convention Codex is already
 * trained on.
 */

export interface PlanSpec {
  /** The plan body, verbatim markdown. */
  planMarkdown: string;
  /** The first markdown heading inside the plan, or null when it has none. */
  title: string | null;
}

export interface ParsedPlanText {
  /** The message text with a valid plan block removed and trimmed. Empty
   * string when the message was nothing but the block. */
  text: string;
  /** The parsed plan, or null when the message had no valid block. */
  plan: PlanSpec | null;
}

/** Defensive ceiling on the plan body. Plans are long-form documents, so this
 * is far looser than the question/controls limits — it only exists so a
 * runaway generation can't flood clients through one event. */
const MAX_PLAN_LENGTH = 100_000;

/** Matches the first plan block. Both tags must sit on their own line
 * (surrounding whitespace allowed) so an inline mention of the tag in prose
 * is never mistaken for a block. Non-greedy: stops at the first closing tag. */
const BLOCK_RE =
  /(?:^|\n)[^\S\r\n]*<proposed_plan>[^\S\r\n]*\r?\n([\s\S]*?)\r?\n[^\S\r\n]*<\/proposed_plan>[^\S\r\n]*(?=\n|$)/;

/** The first ATX heading in the plan markdown, used as the card title. */
function planTitle(planMarkdown: string): string | null {
  const heading = /^[^\S\r\n]{0,3}#{1,6}[^\S\r\n]+(.+)$/m.exec(planMarkdown)?.[1]?.trim();
  return heading && heading.length > 0 ? heading : null;
}

export function parseProposedPlan(raw: string): ParsedPlanText {
  const match = BLOCK_RE.exec(raw);
  if (!match) return { text: raw, plan: null };

  const planMarkdown = (match[1] ?? "").replace(/\r\n/g, "\n").trim();
  if (!planMarkdown || planMarkdown.length > MAX_PLAN_LENGTH) {
    return { text: raw, plan: null };
  }

  // Removing the block from the middle of a message leaves the blank lines
  // that bracketed it stacked together — collapse those so the prose reads
  // naturally either side of the seam.
  const text = (raw.slice(0, match.index) + raw.slice(match.index + match[0].length))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, plan: { planMarkdown, title: planTitle(planMarkdown) } };
}
