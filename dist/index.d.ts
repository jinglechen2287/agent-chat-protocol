import { A as QuestionSpec, C as SelectControl, D as validateControls, E as parseControlsBlock, O as valuesEqual, S as ParsedControlsText, T as initialControlValues, _ as validateViewSpec, a as ChatStreamEvent, b as ControlValues, c as ToolPlanItem, d as ParsedViewText, f as VIEW_CATALOG, g as parseViewBlock, h as ViewSpec, i as BackgroundAgentStatus, j as parseQuestionBlock, k as ParsedQuestionText, l as ToolTaskMetadata, m as ViewComponent, n as BackgroundAgent, o as PROTOCOL_VERSION, p as VIEW_PROMPT, r as BackgroundAgentProgress, s as ToolCallDetail, t as AbortReason, u as isTerminalEvent, v as ColorControl, w as SliderControl, x as ControlsSpec, y as Control } from "./events-qYGUQ2KB.js";
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
//#region src/plan.d.ts
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
interface PlanSpec {
  /** The plan body, verbatim markdown. */
  planMarkdown: string;
  /** The first markdown heading inside the plan, or null when it has none. */
  title: string | null;
}
interface ParsedPlanText {
  /** The message text with a valid plan block removed and trimmed. Empty
   * string when the message was nothing but the block. */
  text: string;
  /** The parsed plan, or null when the message had no valid block. */
  plan: PlanSpec | null;
}
declare function parseProposedPlan(raw: string): ParsedPlanText;
//#endregion
//#region src/html.d.ts
/**
 * The ```agent-html``` grammar: a freeform generated page, streamed raw and
 * rendered in a sandboxed frame — the escape hatch for layouts and
 * interactions the component catalog can't express.
 *
 * Unlike a view, the block body is not validated structure: it is an HTML
 * document the client morphs into the frame as it streams and re-mounts
 * whole once complete. The only vocabulary the protocol fixes is the
 * postMessage bridge between the frame and its host, defined here so both
 * sides (and the prompt that teaches the in-page `AgentBridge` API) cannot
 * drift.
 *
 * Degradation matches views: an empty or oversized block stays in the prose
 * as plain text.
 */
/** Longest text a frame's `AgentBridge.send` may submit as the next user
 * message — mirrors the view catalog's Button message cap. */
declare const HTML_SEND_MAX = 1000;
/** Host → frame: the accumulated document so far; `done` marks the final
 * frame, after which scripts are live and no further updates arrive. */
interface HtmlUpdateMessage {
  type: "agent-html:update";
  html: string;
  done: boolean;
}
/** Host → frame: the app's active color scheme changed. */
interface HtmlThemeMessage {
  type: "agent-html:theme";
  theme: "light" | "dark";
}
type HtmlParentToFrame = HtmlUpdateMessage | HtmlThemeMessage;
/** Frame → host: bootstrap is loaded and listening; updates may start. */
interface HtmlReadyMessage {
  type: "agent-html:ready";
}
/** Frame → host: the document's content height, for sizing the iframe. */
interface HtmlHeightMessage {
  type: "agent-html:height";
  height: number;
}
/** Frame → host: text to submit as the user's next chat message (the
 * freeform twin of a view Button's message template). */
interface HtmlSendMessage {
  type: "agent-html:send";
  text: string;
}
type HtmlFrameToParent = HtmlReadyMessage | HtmlHeightMessage | HtmlSendMessage;
/**
 * Validates a frame-origin postMessage payload. The frame runs agent-authored
 * code, so the host treats its messages as untrusted input: unknown types,
 * non-finite heights, and over-long send texts are rejected.
 */
declare function parseHtmlFrameMessage(data: unknown): HtmlFrameToParent | null;
interface ParsedHtmlText {
  /** The message text with a valid html block removed and trimmed. */
  text: string;
  /** The block body, or null when the message had no renderable block. */
  html: string | null;
}
/**
 * Extracts the first ```agent-html``` block. An empty or oversized block is
 * left in the prose as plain text, exactly like a rootless view block.
 */
declare function parseHtmlBlock(raw: string): ParsedHtmlText;
/** The prompt section that teaches the html block and the in-frame bridge
 * API. Apps append it behind the user's request in experiment-style modes;
 * a test keeps it covering the load-bearing rules. */
declare const HTML_PROMPT: string;
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
declare const VIEW_BLOCK_NAME = "agent-view";
declare const HTML_BLOCK_NAME = "agent-html";
/** Accepted by the parsers during migration; do not teach agents to emit. */
declare const LEGACY_QUESTION_BLOCK_NAME = "carve-question";
/** Accepted by the parsers during migration; do not teach agents to emit. */
declare const LEGACY_CONTROLS_BLOCK_NAME = "carve-controls";
/** Teaches a plan-mode turn its output contract: research freely, change
 * nothing, and end the final message with a `<proposed_plan>` block that the
 * client lifts into a plan card (see plan.ts for the parse side).
 *
 * Written for headless CLI turns on either provider. Claude runs it under
 * `--permission-mode plan` with ExitPlanMode disallowed (the -p CLI never
 * enables that tool, and without this contract the model hunts for it);
 * Codex runs it under a read-only sandbox policy. The prompt is what aligns
 * both on one plan-delivery channel. */
declare const PLAN_PROMPT: string;
/** Teaches the clarifying-question block. Framework- and DOM-agnostic. */
declare const QUESTION_PROMPT: string;
//#endregion
export { type AbortReason, type BackgroundAgent, type BackgroundAgentProgress, type BackgroundAgentStatus, CONTROLS_BLOCK_NAME, type ChatStreamEvent, type ColorControl, type ConsumeSseOptions, type Control, type ControlValues, type ControlsSpec, HTML_BLOCK_NAME, HTML_PROMPT, HTML_SEND_MAX, type HtmlFrameToParent, type HtmlHeightMessage, type HtmlParentToFrame, type HtmlReadyMessage, type HtmlSendMessage, type HtmlThemeMessage, type HtmlUpdateMessage, LEGACY_CONTROLS_BLOCK_NAME, LEGACY_QUESTION_BLOCK_NAME, PLAN_PROMPT, PROTOCOL_VERSION, type ParsedControlsText, type ParsedHtmlText, type ParsedPlanText, type ParsedQuestionText, type ParsedViewText, type PlanSpec, QUESTION_BLOCK_NAME, QUESTION_PROMPT, type QuestionSpec, type SelectControl, type SliderControl, type SseEvent, type SseParseResult, type ToolCallDetail, type ToolPlanItem, type ToolTaskMetadata, VIEW_BLOCK_NAME, VIEW_CATALOG, VIEW_PROMPT, type ViewComponent, type ViewSpec, consumeSseResponse, encodeChatEvent, formatSseEvent, initialControlValues, isTerminalEvent, mapSseToChatEvent, parseControlsBlock, parseHtmlBlock, parseHtmlFrameMessage, parseProposedPlan, parseQuestionBlock, parseSseBuffer, parseViewBlock, toSseEvent, validateControls, validateViewSpec, valuesEqual };
//# sourceMappingURL=index.d.ts.map