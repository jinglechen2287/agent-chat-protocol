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

/** Tells a turn with full access that limits set by earlier turns' modes are
 * over. A host only needs it on a conversation that has had a restricted turn. */
export const BUILD_PROMPT: string =
  "You are in Build mode: limits from earlier turns' modes no longer apply.";

/** Teaches a plan-mode turn its output contract: research freely, change
 * nothing, and end the final message with a `<proposed_plan>` block that the
 * client lifts into a plan card (see plan.ts for the parse side).
 *
 * Written for headless turns on either provider. Claude runs it in the `plan`
 * permission mode, where a headless session has no approval channel behind
 * ExitPlanMode (without this contract the model hunts for it); Codex runs it
 * under a read-only sandbox policy. The prompt is what aligns both on one
 * plan-delivery channel. */
export const PLAN_PROMPT: string = [
  "## Plan mode",
  "",
  "This turn produces a plan, not changes: treat every request, however imperative, as a request to plan the work.",
  "",
  "Read, search, and run non-mutating commands to make the plan accurate. Explore before asking; ask only what exploration can't answer. Don't edit files, apply patches, or run formatters or codegen.",
  "",
  "Don't call ExitPlanMode, since nothing is behind it, and don't write the plan to a file.",
  "",
  "When nothing is left for the implementer to decide, end your final message with one block, each tag on its own line and markdown inside:",
  "",
  "<proposed_plan>",
  "# Clear title",
  "",
  "Brief summary, the concrete changes (files, interfaces, code where it helps), how to verify, and any assumptions you chose.",
  "</proposed_plan>",
  "",
  'Don\'t ask "should I proceed?" afterwards; the client offers to implement it.',
].join("\n");

/** Teaches a chat-mode turn its contract: it can read, search, and run commands
 * but not edit files. The host enforces that: a Claude host with a tool guard on
 * the file tools and an OS sandbox on the shell, Codex with a read-only turn
 * sandbox. It uses the question block, so a host sends {@link QUESTION_PROMPT}
 * too. No parse side exists: the reply is ordinary assistant text. */
export const CHAT_PROMPT: string = [
  "## Chat mode",
  "",
  "You can read, search, and run commands, but not edit files by any route: file tools, shell, or MCP.",
  "",
  "If an action is blocked, don't work around it: ask with a question block whose approve option names the exact action.",
].join("\n");

/** Teaches the clarifying-question block. Framework- and DOM-agnostic. */
export const QUESTION_PROMPT: string = [
  "- If the request is genuinely ambiguous (multiple reasonable interpretations), ask one short clarifying question instead of guessing, and don't make edits that turn. Otherwise apply the change directly.",
  "- When a clarifying question has a small, fixed set of answers, end your message with a question block so the user can answer in one click:",
  `  \`\`\`${QUESTION_BLOCK_NAME}`,
  '  {"question": "Short question?", "options": ["First choice", "Second choice"]}',
  "  ```",
  "  Emit at most one such block, as the very last thing in the message, with 1–6 short option labels. The user's pick (or a typed reply) arrives as the next message. If the answer isn't a small fixed set of choices, just ask in plain text.",
].join("\n");

