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
  CHAT_TITLE_MODELS,
  createChatTitleGenerator,
  type ChatTitleGeneratorOptions,
  type ChatTitleInput,
  type ChatTitleProvider,
  type ChatTitleResult,
  type ChatTitleRunner,
  type ChatTitleRunRequest,
  type ChatTitleRunResult,
  type ChatTitleSource,
} from "./title";

/** The client-safe title text rules, re-exported so a server-side host
 * reaches the whole title API through one entry; they also live on the
 * package root. */
export {
  CHAT_TITLE_MAX_LENGTH,
  CHAT_TITLE_RECENT_MESSAGE_LIMIT,
  CHAT_TITLE_TASK_MAX_LENGTH,
  fallbackChatTitle,
  normalizeChatTitle,
  normalizeTaskSummary,
  toChatTitleMessages,
  truncateChatTitle,
  type ChatTitleMessage,
} from "../title-text";

/** Emit-side event helper, client-safe on the package root as well. */
export { threadTitleEvent } from "../events";
