import { _ as ParsedQuestionText, a as isTerminalEvent, c as ControlValues, d as SelectControl, f as SliderControl, g as valuesEqual, h as validateControls, i as ToolCallDetail, l as ControlsSpec, m as parseControlsBlock, n as ChatStreamEvent, o as ColorControl, p as initialControlValues, r as PROTOCOL_VERSION, s as Control, t as AbortReason, u as ParsedControlsText, v as QuestionSpec, y as parseQuestionBlock } from "./events-CXmHO5K8.js";
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
interface ConsumeSseOptions<TEvent = ChatStreamEvent> {
  /**
   * Overrides the frame→event mapping (default {@link mapSseToChatEvent}).
   * Apps that extend the controls spec supply a mapper that re-validates
   * `controls` payloads with their own validator; the default mapper
   * canonicalizes controls to the core widgets-only spec, dropping extension
   * fields.
   */
  mapEvent?: (ev: SseEvent) => TEvent | null;
}
/**
 * Reads a fetch Response body as an SSE stream, mapping each frame into a
 * typed event. Resolves when the stream ends; rejects on a non-OK response.
 * Frames that don't map (unknown names, malformed payloads) are skipped.
 * The overloads tie a narrowed event type to the presence of a custom
 * `mapEvent` — without one, events are the default union.
 */
declare function consumeSseResponse(res: Response, onEvent: (e: ChatStreamEvent) => void, options?: ConsumeSseOptions<ChatStreamEvent>): Promise<void>;
declare function consumeSseResponse<TEvent>(res: Response, onEvent: (e: TEvent) => void, options: ConsumeSseOptions<TEvent> & {
  mapEvent: (ev: SseEvent) => TEvent | null;
}): Promise<void>;
//#endregion
//#region src/prompt.d.ts
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
declare const QUESTION_BLOCK_NAME = "agent-question";
declare const CONTROLS_BLOCK_NAME = "agent-controls";
/** Accepted by the parsers during migration; do not teach agents to emit. */
declare const LEGACY_QUESTION_BLOCK_NAME = "carve-question";
/** Accepted by the parsers during migration; do not teach agents to emit. */
declare const LEGACY_CONTROLS_BLOCK_NAME = "carve-controls";
/** Teaches the clarifying-question block. Framework- and DOM-agnostic. */
declare const QUESTION_PROMPT: string;
//#endregion
export { type AbortReason, CONTROLS_BLOCK_NAME, type ChatStreamEvent, type ColorControl, type ConsumeSseOptions, type Control, type ControlValues, type ControlsSpec, LEGACY_CONTROLS_BLOCK_NAME, LEGACY_QUESTION_BLOCK_NAME, PROTOCOL_VERSION, type ParsedControlsText, type ParsedQuestionText, QUESTION_BLOCK_NAME, QUESTION_PROMPT, type QuestionSpec, type SelectControl, type SliderControl, type SseEvent, type SseParseResult, type ToolCallDetail, consumeSseResponse, encodeChatEvent, formatSseEvent, initialControlValues, isTerminalEvent, mapSseToChatEvent, parseControlsBlock, parseQuestionBlock, parseSseBuffer, toSseEvent, validateControls, valuesEqual };
//# sourceMappingURL=index.d.ts.map