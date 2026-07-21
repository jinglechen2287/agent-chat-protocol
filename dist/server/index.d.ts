import { a as ChatStreamEvent, l as ToolTaskMetadata, s as ToolCallDetail, x as ControlsSpec } from "../events-CaRmWv7u.js";
import { AgentCallbacks, ToolUseInfo } from "agent-cli-runner";
//#region src/server/bridge.d.ts
interface ChatEventBridgeOptions {
  /**
   * A session id the caller minted before spawning (so the client learns it
   * even if the CLI dies before reporting one). The bridge announces it
   * immediately; if the runner later reports a different id, that one is
   * announced too and supersedes it.
   */
  presetSessionId?: string;
  /**
   * The session id of a resumed turn — the client already holds it, so the
   * contract says `session_started` is not re-emitted. The bridge treats it
   * as already announced; a *different* runner-reported id is still announced
   * (the client must learn a changed id or its next resume would fail).
   */
  knownSessionId?: string;
  /**
   * Overrides controls-block validation (default: the core widgets-only
   * validator). Apps that extend the spec (e.g. carve's CSS style bindings)
   * pass their validator; when it rejects a block, the block stays in the
   * assistant text as prose, exactly like a malformed block.
   */
  controlsValidator?: (value: unknown) => ControlsSpec | null;
}
interface ChatEventBridge {
  /** Wire these into the runner's run options. */
  callbacks: Required<AgentCallbacks>;
  /** Call with the runner's result to emit the terminal `done` event. */
  finish(result: {
    exitCode: number;
  }): void;
  /** Call with the runner's rejection to emit the terminal event: AbortError
   * → `aborted` (user), TimeoutError → `aborted` (timeout), else `error`. */
  fail(err: unknown): void;
}
declare function createChatEventBridge(emit: (ev: ChatStreamEvent) => void, options?: ChatEventBridgeOptions): ChatEventBridge;
//#endregion
//#region src/server/task-store.d.ts
interface TurnTask {
  id: string;
  /** Every event pushed so far, in order — the replay buffer. */
  events: ChatStreamEvent[];
  /** In-progress assistant text keyed by message index. Deliberately outside
   * the replay buffer: a fragment per token would make every reattach replay
   * thousands of frames to rebuild text the completed message supersedes.
   * An entry is dropped once that message's `assistant_text` is buffered. */
  partials: Map<number, string>;
  done: boolean;
  /** Abort this to cancel the underlying run (wire it into the runner). */
  abort: AbortController;
  subscribers: Set<(ev: ChatStreamEvent) => void>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}
interface TaskStoreOptions {
  /** How long a completed task stays reattachable. Default 5 minutes. */
  completeTtlMs?: number;
}
interface CompleteOptions {
  /** Overrides the store-level TTL for this task. */
  ttlMs?: number;
}
type AssistantTextDelta = Extract<ChatStreamEvent, {
  type: "assistant_text_delta";
}>;
interface TaskStore {
  get(id: string): TurnTask | undefined;
  /** Returns the existing task when the id is already registered. */
  create(id: string): TurnTask;
  /** Buffers the event and notifies current subscribers. */
  push(task: TurnTask, ev: ChatStreamEvent): void;
  /** Notifies subscribers of a text fragment and accumulates it per message
   * index, without adding it to the replay buffer. */
  pushPartial(task: TurnTask, ev: AssistantTextDelta): void;
  /** One fragment per in-flight message carrying everything accumulated so
   * far, in index order. Replay these to a late subscriber after `task.events`
   * so it catches up to where a connected client already is. */
  pendingPartials(task: TurnTask): AssistantTextDelta[];
  /** Returns an unsubscribe function. */
  subscribe(task: TurnTask, listener: (ev: ChatStreamEvent) => void): () => void;
  /** Marks the task done and schedules its removal after the TTL. */
  complete(task: TurnTask, options?: CompleteOptions): void;
  /** Aborts the task's signal. Returns false when the id is unknown. */
  cancel(id: string): boolean;
  /** Removes the task immediately, clearing any pending TTL timer. */
  delete(id: string): void;
}
declare function createTaskStore(options?: TaskStoreOptions): TaskStore;
//#endregion
//#region src/server/tool-details.d.ts
/** Extracts the stable task identity that clients use to correlate task calls. */
declare function toolTaskMetadata(info: ToolUseInfo): ToolTaskMetadata | undefined;
/**
 * Reduce provider-specific raw tool input to the useful values the transcript
 * should retain.
 */
declare function toolCallDetails(info: ToolUseInfo): ToolCallDetail[];
//#endregion
//#region src/server/title.d.ts
declare const CHAT_TITLE_MODELS: {
  readonly claude: "haiku";
  readonly codex: "gpt-5.6-luna";
};
type ChatTitleProvider = keyof typeof CHAT_TITLE_MODELS;
type ChatTitleSource = "model" | "fallback";
interface ChatTitleInput {
  provider: ChatTitleProvider;
  prompt: string;
  /** Existing generated title. The model should preserve it unless the main
   * task has materially changed. Omit for a chat's first user request. */
  currentTitle?: string;
  /** Earlier user requests, oldest first. Callers should pass only the most
   * recent few messages needed to identify topic drift. */
  previousPrompts?: readonly string[];
  attachmentNames?: readonly string[];
  signal?: AbortSignal;
}
interface ChatTitleRunRequest {
  provider: ChatTitleProvider;
  prompt: string;
  model: string;
  effort: "low";
  isolated: true;
  timeoutMs: number;
  signal?: AbortSignal;
}
interface ChatTitleRunResult {
  text: string;
  exitCode: number;
}
type ChatTitleRunner = (request: ChatTitleRunRequest) => Promise<ChatTitleRunResult>;
interface ChatTitleResult {
  title: string;
  source: ChatTitleSource;
}
interface ChatTitleGeneratorOptions {
  run: ChatTitleRunner;
  timeoutMs?: number;
  maxInputChars?: number;
}
declare function normalizeChatTitle(raw: string): string | undefined;
declare function fallbackChatTitle(prompt: string, attachmentNames?: readonly string[]): string;
declare function createChatTitleGenerator(options: ChatTitleGeneratorOptions): (input: ChatTitleInput) => Promise<ChatTitleResult>;
//#endregion
export { CHAT_TITLE_MODELS, type ChatEventBridge, type ChatEventBridgeOptions, type ChatTitleGeneratorOptions, type ChatTitleInput, type ChatTitleProvider, type ChatTitleResult, type ChatTitleRunRequest, type ChatTitleRunResult, type ChatTitleRunner, type ChatTitleSource, type CompleteOptions, type TaskStore, type TaskStoreOptions, type TurnTask, createChatEventBridge, createChatTitleGenerator, createTaskStore, fallbackChatTitle, normalizeChatTitle, toolCallDetails, toolTaskMetadata };
//# sourceMappingURL=index.d.ts.map