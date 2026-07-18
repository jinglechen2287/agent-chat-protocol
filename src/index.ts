/**
 * agent-chat-protocol — the client-safe entry point.
 *
 * Everything here runs in the browser: event types, the SSE codec, the
 * generative-UI parsers/validators, and the emit-side prompt sections. The
 * server-side glue (runner bridge, task store, tool-detail projection) lives
 * behind `agent-chat-protocol/server`.
 */

export {
  PROTOCOL_VERSION,
  isTerminalEvent,
  type AbortReason,
  type ChatStreamEvent,
  type ToolCallDetail,
} from "./events";

export {
  consumeSseResponse,
  encodeChatEvent,
  formatSseEvent,
  mapSseToChatEvent,
  parseSseBuffer,
  toSseEvent,
  type ConsumeSseOptions,
  type SseEvent,
  type SseParseResult,
} from "./sse";

export {
  parseQuestionBlock,
  type ParsedQuestionText,
  type QuestionSpec,
} from "./question";

export {
  initialControlValues,
  parseControlsBlock,
  validateControls,
  valuesEqual,
  type ColorControl,
  type Control,
  type ControlValues,
  type ControlsSpec,
  type ParsedControlsText,
  type SelectControl,
  type SliderControl,
} from "./controls";

export {
  CONTROLS_BLOCK_NAME,
  LEGACY_CONTROLS_BLOCK_NAME,
  LEGACY_QUESTION_BLOCK_NAME,
  QUESTION_BLOCK_NAME,
  QUESTION_PROMPT,
} from "./prompt";
