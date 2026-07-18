/**
 * The emit side of the generative-UI grammar: prompt sections that teach an
 * agent when and how to end a message with an ```agent-question``` or
 * ```agent-controls``` block. Apps append these to their system prompt (Claude
 * `--append-system-prompt`, Codex `developerInstructions`) so the grammar
 * survives long conversations where early user messages get compacted away.
 *
 * Kept in this package alongside the parse-side (parseQuestionBlock /
 * parseControlsBlock) so the two can't drift.
 *
 * Compose what fits the app: a non-DOM client (a phone app, a Telegram bot)
 * appends only QUESTION_PROMPT; a DOM client appends GENERATIVE_UI_PROMPT.
 */

export const QUESTION_BLOCK_NAME = "agent-question";
export const CONTROLS_BLOCK_NAME = "agent-controls";
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

/** Teaches the controls block, including the scope model. The scope guidance
 * assumes the conversation is about a page with selectable elements — apps
 * without that context should still include this section unchanged; the agent
 * simply won't have elements to scope to and the user won't be offered
 * element-picking flows. */
export const CONTROLS_PROMPT: string = [
  "- When the request is about tuning a continuous visual property by eye (shadows, corner radius, colors, spacing, typography scale), do not guess final values and do not edit code that turn. Instead end your message with a controls block; the user gets live number inputs with scrubbers and pickers and will send you the final values to implement:",
  `  \`\`\`${CONTROLS_BLOCK_NAME}`,
  '  {"title": "Card shadow & corners", "scope": {"type": "element"}, "controls": [{"id": "y", "type": "slider", "label": "Offset Y", "min": -20, "max": 40, "step": 1, "unit": "px", "value": 4}, {"id": "blur", "type": "slider", "label": "Blur", "min": 0, "max": 80, "step": 1, "unit": "px", "value": 12}, {"id": "shadowColor", "type": "color", "label": "Shadow color", "value": "#1f293733"}, {"id": "radius", "type": "slider", "label": "Corner radius", "min": 0, "max": 32, "step": 1, "unit": "px", "value": 8}, {"id": "weight", "type": "select", "label": "Font weight", "options": ["400", "500", "600", "700"], "value": "600"}], "styles": [{"property": "box-shadow", "template": "0px {y} {blur} 0px {shadowColor}"}, {"property": "border-radius", "template": "{radius}"}, {"property": "font-weight", "template": "{weight}"}]}',
  "  ```",
  '  Scope: you must inspect the request and source structure, then choose the adjustment and preview scope yourself. Use {"type": "element"} when the user explicitly means only the selected element instance or the element is unique. Use {"type": "selector", "selector": "img.project-images", "label": "All project images"} when the selected instance is governed by a repeated shared class or component and the change naturally belongs in that shared source styling, unless the user explicitly asks for only this instance. A selector scope must be a stable class selector (optionally prefixed by a tag), must include the picked element, and must not use selector lists, combinators, attributes, pseudo-classes, or a tag by itself.',
  '  Rules: when emitting controls, output only the controls block — no prose before or after it. Do not include file excerpts, relevant rules, search results, implementation notes, or explanations that a property does not exist. If the property is absent, use a sensible visual default for the initial value and render the controls anyway. Emit at most one block; include exactly one "scope"; use 1–8 controls; every control id must appear in at least one style template; templates compose full CSS values with {id} placeholders (hardcode the parts you don\'t want tuned); slider values get "unit" appended automatically; seed each control\'s "value" from the element\'s computed styles in the message context when available so the panel starts at the current rendering. The user\'s follow-up "Apply these style values..." message contains the final CSS — implement it in the project\'s existing styling idiom.',
  "  Lifecycle: a controls panel stays live only until the next user message. Sending any next user message — including a typed follow-up or the dedicated Apply follow-up — immediately disables that panel and clears its temporary preview, restoring the source-rendered styles. Never tell the user that an earlier controls panel is still live or usable after a follow-up. If controls are needed again, emit a new controls block.",
  '- For one-shot changes ("make it red"), just edit — don\'t emit controls.',
].join("\n");

/** Both grammar sections, ready to append to an app's system prompt. */
export const GENERATIVE_UI_PROMPT: string = [
  QUESTION_PROMPT,
  CONTROLS_PROMPT,
].join("\n");
