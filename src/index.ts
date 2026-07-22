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
  type BackgroundAgent,
  type BackgroundAgentProgress,
  type BackgroundAgentStatus,
  type ChatStreamEvent,
  type ToolCallDetail,
  type ToolPlanItem,
  type ToolTaskMetadata,
  type UserInputOption,
  type UserInputQuestion,
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
  parseProposedPlan,
  type ParsedPlanText,
  type PlanSpec,
} from "./plan";

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
  HTML_PROMPT,
  HTML_SEND_MAX,
  parseHtmlBlock,
  parseHtmlFrameMessage,
  type HtmlFrameToParent,
  type HtmlHeightMessage,
  type HtmlParentToFrame,
  type HtmlReadyMessage,
  type HtmlSendMessage,
  type HtmlThemeMessage,
  type HtmlUpdateMessage,
  type ParsedHtmlText,
} from "./html";

export {
  CHAT_PROMPT,
  CONTROLS_BLOCK_NAME,
  HTML_BLOCK_NAME,
  LEGACY_CONTROLS_BLOCK_NAME,
  LEGACY_QUESTION_BLOCK_NAME,
  PLAN_PROMPT,
  QUESTION_BLOCK_NAME,
  QUESTION_PROMPT,
  VIEW_BLOCK_NAME,
} from "./prompt";

export {
  VIEW_CATALOG,
  VIEW_PROMPT,
  parseViewBlock,
  validateViewSpec,
  type ParsedViewText,
  type ViewComponent,
  type ViewSpec,
} from "./view";
