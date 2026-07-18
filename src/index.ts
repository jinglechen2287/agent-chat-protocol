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
  type SseEvent,
  type SseParseResult,
} from "./sse";

export {
  parseQuestionBlock,
  type ParsedQuestionText,
  type QuestionSpec,
} from "./question";

export {
  buildStyleMap,
  composeApplyMessage,
  initialControlValues,
  parseControlsBlock,
  validateControls,
  valuesEqual,
  type ColorControl,
  type Control,
  type ControlValues,
  type ControlsScope,
  type ControlsSpec,
  type ElementControlsScope,
  type ParsedControlsText,
  type SelectControl,
  type SelectorControlsScope,
  type SliderControl,
  type StyleBinding,
} from "./controls";

export {
  CONTROLS_BLOCK_NAME,
  CONTROLS_PROMPT,
  GENERATIVE_UI_PROMPT,
  LEGACY_CONTROLS_BLOCK_NAME,
  LEGACY_QUESTION_BLOCK_NAME,
  QUESTION_BLOCK_NAME,
  QUESTION_PROMPT,
} from "./prompt";
