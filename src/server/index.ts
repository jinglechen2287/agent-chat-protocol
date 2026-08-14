/**
 * agent-chat-protocol/server — the server-only entry point.
 *
 * Glue between agent-cli-runner and the wire contract: the callbacks→events
 * bridge, the reattachable turn store, and the tool-detail projection. Keep
 * this out of browser bundles; everything client-safe lives in the root entry.
 */

export {
  createChatEventBridge,
  type ChatEventBridge,
  type ChatEventBridgeOptions,
} from "./bridge";

export {
  createTaskStore,
  type CompleteOptions,
  type TaskStore,
  type TaskStoreOptions,
  type TurnTask,
} from "./task-store";

export { toolCallDetails, toolTaskMetadata } from "./tool-details";

export {
  CHAT_TITLE_MAX_LENGTH,
  CHAT_TITLE_MODELS,
  CHAT_TITLE_RECENT_MESSAGE_LIMIT,
  CHAT_TITLE_TASK_MAX_LENGTH,
  createChatTitleGenerator,
  fallbackChatTitle,
  normalizeChatTitle,
  normalizeTaskSummary,
  toChatTitleMessages,
  truncateChatTitle,
  type ChatTitleGeneratorOptions,
  type ChatTitleInput,
  type ChatTitleMessage,
  type ChatTitleProvider,
  type ChatTitleResult,
  type ChatTitleRunner,
  type ChatTitleRunRequest,
  type ChatTitleRunResult,
  type ChatTitleSource,
} from "./title";
