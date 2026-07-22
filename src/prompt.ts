/**
 * The emit side of the generative-UI grammar: the prompt section that teaches
 * an agent when and how to end a message with an ```agent-question``` block.
 * Apps append it to their system prompt (Claude `--append-system-prompt`,
 * Codex `developerInstructions`) so the grammar survives long conversations
 * where early user messages get compacted away.
 *
 * Kept in this package alongside the parse-side (parseQuestionBlock) so the
 * two can't drift.
 *
 * Controls emission guidance is app-specific — what the controls tune (CSS in
 * carve's case) is an app extension, so each app authors its own controls
 * prompt section, using {@link CONTROLS_BLOCK_NAME} as the fence and keeping
 * the core widget schema this package validates.
 */

export const QUESTION_BLOCK_NAME = "agent-question";
export const CONTROLS_BLOCK_NAME = "agent-controls";
export const VIEW_BLOCK_NAME = "agent-view";
export const HTML_BLOCK_NAME = "agent-html";
/** Accepted by the parsers during migration; do not teach agents to emit. */
export const LEGACY_QUESTION_BLOCK_NAME = "carve-question";
/** Accepted by the parsers during migration; do not teach agents to emit. */
export const LEGACY_CONTROLS_BLOCK_NAME = "carve-controls";

/** Teaches a plan-mode turn its output contract: research freely, change
 * nothing, and end the final message with a `<proposed_plan>` block that the
 * client lifts into a plan card (see plan.ts for the parse side).
 *
 * Written for headless CLI turns on either provider. Claude runs it under
 * `--permission-mode plan` with ExitPlanMode disallowed (the -p CLI never
 * enables that tool, and without this contract the model hunts for it);
 * Codex runs it under a read-only sandbox policy. The prompt is what aligns
 * both on one plan-delivery channel. */
export const PLAN_PROMPT: string = [
  "## Plan mode",
  "",
  "You are in plan mode: this turn produces a plan, not changes. Treat every",
  "request — however imperative — as a request to plan the work, not do it.",
  "",
  "Allowed: reading and searching files, inspecting configs and schemas, and",
  "other non-mutating commands that make the plan more accurate. Explore",
  "before asking; only ask the user what exploration cannot answer.",
  "Not allowed: editing or writing files, applying patches, running",
  "formatters or codegen, or any command whose purpose is to carry out the",
  "work rather than refine the plan.",
  "",
  "You are running headless inside a chat client:",
  "- The ExitPlanMode tool is NOT available here and MUST NOT be called —",
  "  there is no approval channel behind it.",
  "- Do not write the plan to a file; the client cannot read files.",
  "",
  "When the plan is complete and decision-complete (the implementer needs to",
  "make no further decisions), end your final message with the plan wrapped",
  "in a proposed-plan block:",
  "",
  "<proposed_plan>",
  "# Clear title",
  "",
  "Brief summary, the concrete changes (files, interfaces, code where it",
  "helps), how to verify, and any assumptions you chose.",
  "</proposed_plan>",
  "",
  "Rules for the block: each tag on its own line, markdown inside, keep the",
  "tag names exactly as written, and emit at most one block per turn — only",
  'when the plan is complete. Do not ask "should I proceed?" afterwards; the',
  "client offers implementation to the user itself.",
].join("\n");

/** Teaches the clarifying-question block. Framework- and DOM-agnostic. */
export const QUESTION_PROMPT: string = [
  "- If the request is genuinely ambiguous (multiple reasonable interpretations), ask one short clarifying question instead of guessing, and don't make edits that turn. Otherwise apply the change directly.",
  "- When a clarifying question has a small, fixed set of answers, end your message with a question block so the user can answer in one click:",
  `  \`\`\`${QUESTION_BLOCK_NAME}`,
  '  {"question": "Short question?", "options": ["First choice", "Second choice"]}',
  "  ```",
  "  Emit at most one such block, as the very last thing in the message, with 2–6 short option labels. The user's pick (or a typed reply) arrives as the next message. If the answer isn't a small fixed set of choices, just ask in plain text.",
].join("\n");

