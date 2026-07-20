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
  fallbackChatTitle,
  normalizeChatTitle,
  type ChatTitleGeneratorOptions,
  type ChatTitleInput,
  type ChatTitleProvider,
  type ChatTitleResult,
  type ChatTitleRunner,
  type ChatTitleRunRequest,
  type ChatTitleRunResult,
  type ChatTitleSource,
} from "./title";
