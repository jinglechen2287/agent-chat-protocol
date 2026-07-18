import { C as ParsedQuestionText, S as valuesEqual, T as parseQuestionBlock, _ as buildStyleMap, a as isTerminalEvent, b as parseControlsBlock, c as ControlValues, d as ElementControlsScope, f as ParsedControlsText, g as StyleBinding, h as SliderControl, i as ToolCallDetail, l as ControlsScope, m as SelectorControlsScope, n as ChatStreamEvent, o as ColorControl, p as SelectControl, r as PROTOCOL_VERSION, s as Control, t as AbortReason, u as ControlsSpec, v as composeApplyMessage, w as QuestionSpec, x as validateControls, y as initialControlValues } from "./events-DMGAPOa4.js";
//#region src/sse.d.ts
/** One decoded SSE frame: the `event:` name and the JSON-parsed `data:`
 * payload (left as a string when it isn't valid JSON). */
interface SseEvent {
  event: string;
  data: unknown;
}
interface SseParseResult {
  events: SseEvent[];
  remainder: string;
}
/**
 * Splits an accumulating SSE text buffer into complete frames. Feed it the
 * concatenation of everything received so far that wasn't consumed; it returns
 * the parsed frames and the trailing incomplete remainder to carry forward.
 */
declare function parseSseBuffer(buffer: string): SseParseResult;
/**
 * Validates a decoded SSE frame into the typed event union. Returns null for
 * unknown event names and malformed payloads — clients skip those frames.
 */
declare function mapSseToChatEvent(ev: SseEvent): ChatStreamEvent | null;
/** Converts a typed event into its wire frame: the `type` discriminant becomes
 * the SSE event name; the rest becomes the data payload. The `controls` spec
 * is sent directly as the payload (not wrapped in `{spec}`). */
declare function toSseEvent(ev: ChatStreamEvent): SseEvent;
/** Formats one SSE frame as wire text: `event: <name>\ndata: <json>\n\n`. */
declare function formatSseEvent(ev: SseEvent): string;
/** `formatSseEvent(toSseEvent(ev))` — one typed event to one wire chunk. */
declare function encodeChatEvent(ev: ChatStreamEvent): string;
/**
 * Reads a fetch Response body as an SSE stream, mapping each frame into a
 * typed event. Resolves when the stream ends; rejects on a non-OK response.
 * Frames that don't map (unknown names, malformed payloads) are skipped.
 */
declare function consumeSseResponse(res: Response, onEvent: (e: ChatStreamEvent) => void): Promise<void>;
//#endregion
//#region src/prompt.d.ts
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
declare const QUESTION_BLOCK_NAME = "agent-question";
declare const CONTROLS_BLOCK_NAME = "agent-controls";
/** Accepted by the parsers during migration; do not teach agents to emit. */
declare const LEGACY_QUESTION_BLOCK_NAME = "carve-question";
/** Accepted by the parsers during migration; do not teach agents to emit. */
declare const LEGACY_CONTROLS_BLOCK_NAME = "carve-controls";
/** Teaches the clarifying-question block. Framework- and DOM-agnostic. */
declare const QUESTION_PROMPT: string;
/** Teaches the controls block, including the scope model. The scope guidance
 * assumes the conversation is about a page with selectable elements — apps
 * without that context should still include this section unchanged; the agent
 * simply won't have elements to scope to and the user won't be offered
 * element-picking flows. */
declare const CONTROLS_PROMPT: string;
/** Both grammar sections, ready to append to an app's system prompt. */
declare const GENERATIVE_UI_PROMPT: string;
//#endregion
export { type AbortReason, CONTROLS_BLOCK_NAME, CONTROLS_PROMPT, type ChatStreamEvent, type ColorControl, type Control, type ControlValues, type ControlsScope, type ControlsSpec, type ElementControlsScope, GENERATIVE_UI_PROMPT, LEGACY_CONTROLS_BLOCK_NAME, LEGACY_QUESTION_BLOCK_NAME, PROTOCOL_VERSION, type ParsedControlsText, type ParsedQuestionText, QUESTION_BLOCK_NAME, QUESTION_PROMPT, type QuestionSpec, type SelectControl, type SelectorControlsScope, type SliderControl, type SseEvent, type SseParseResult, type StyleBinding, type ToolCallDetail, buildStyleMap, composeApplyMessage, consumeSseResponse, encodeChatEvent, formatSseEvent, initialControlValues, isTerminalEvent, mapSseToChatEvent, parseControlsBlock, parseQuestionBlock, parseSseBuffer, toSseEvent, validateControls, valuesEqual };
//# sourceMappingURL=index.d.ts.map