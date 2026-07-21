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
/** Accepted by the parsers during migration; do not teach agents to emit. */
export const LEGACY_QUESTION_BLOCK_NAME = "carve-question";
/** Accepted by the parsers during migration; do not teach agents to emit. */
export const LEGACY_CONTROLS_BLOCK_NAME = "carve-controls";

/** Teaches the clarifying-question block. Framework- and DOM-agnostic. */
export const QUESTION_PROMPT: string = [
  "- If the request is genuinely ambiguous (multiple reasonable interpretations), ask one short clarifying question instead of guessing, and don't make edits that turn. Otherwise apply the change directly.",
  "- When a clarifying question has a small, fixed set of answers, end your message with a question block so the user can answer in one click:",
  `  \`\`\`${QUESTION_BLOCK_NAME}`,
  '  {"question": "Short question?", "options": ["First choice", "Second choice"]}',
  "  ```",
  "  Emit at most one such block, as the very last thing in the message, with 2–6 short option labels. The user's pick (or a typed reply) arrives as the next message. If the answer isn't a small fixed set of choices, just ask in plain text.",
].join("\n");

