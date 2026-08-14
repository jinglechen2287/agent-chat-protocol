import { a as ChatStreamEvent, l as ToolTaskMetadata, s as ToolCallDetail, x as ControlsSpec } from "../events-B7TyyJ84.js";
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
  /** In-progress view components keyed by message index, same lifecycle as
   * `partials`: live-only scratch the completed `view` event supersedes. */
  viewPartials: Map<number, AssistantViewLine[]>;
  /** In-progress html accumulated per message index, same lifecycle as
   * `partials`: live-only scratch the completed `html` event supersedes. */
  htmlPartials: Map<number, string>;
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
type AssistantViewLine = Extract<ChatStreamEvent, {
  type: "view_line";
}>;
type AssistantHtmlDelta = Extract<ChatStreamEvent, {
  type: "html_delta";
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
  /** Notifies subscribers of a streamed view component and accumulates it,
   * same lifecycle as {@link pushPartial}. */
  pushViewLine(task: TurnTask, ev: AssistantViewLine): void;
  /** Every accumulated in-flight view line in index-then-arrival order, for
   * late-subscriber catch-up after `task.events`. */
  pendingViewLines(task: TurnTask): AssistantViewLine[];
  /** Notifies subscribers of streamed html and accumulates it per message
   * index, same lifecycle as {@link pushPartial}. */
  pushHtmlDelta(task: TurnTask, ev: AssistantHtmlDelta): void;
  /** One delta per in-flight page carrying everything accumulated so far, in
   * index order, for late-subscriber catch-up after `task.events`. */
  pendingHtmlDeltas(task: TurnTask): AssistantHtmlDelta[];
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
interface ChatTitleMessage {
  role: "user" | "assistant";
  text: string;
}
interface ChatTitleInput {
  provider: ChatTitleProvider;
  prompt: string;
  /** Existing generated or manually chosen title. */
  currentTitle?: string;
  /** Durable summary of the conversation's umbrella objective. */
  overarchingTask?: string;
  /** Unconfirmed unrelated task from the preceding user request. */
  pivotCandidate?: string;
  /** The conversation's first user request, used as a historical anchor. */
  firstPrompt?: string;
  /** Recent semantic conversation context, oldest first. */
  recentMessages?: readonly ChatTitleMessage[];
  /** @deprecated Prefer `recentMessages`, which can include assistant context. */
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
  overarchingTask?: string;
  pivotCandidate?: string;
}
interface ChatTitleGeneratorOptions {
  run: ChatTitleRunner;
  timeoutMs?: number;
  maxInputChars?: number;
}
/** Widest a chat title gets, in UTF-16 units. */
declare const CHAT_TITLE_MAX_LENGTH = 60;
/** Widest an `overarchingTask` or `pivotCandidate` summary gets. */
declare const CHAT_TITLE_TASK_MAX_LENGTH = 400;
/** Recent messages a host sends as title context unless it says otherwise. */
declare const CHAT_TITLE_RECENT_MESSAGE_LIMIT = 12;
/** Bounds a chat title to {@link CHAT_TITLE_MAX_LENGTH}. Exported so a host
 * deriving its own offline title (the first line of a message, say) lands on
 * the same width as a generated one instead of re-deriving the bound. */
declare function truncateChatTitle(title: string): string;
declare function normalizeChatTitle(raw: string): string | undefined;
/**
 * Bounds a task summary to {@link CHAT_TITLE_TASK_MAX_LENGTH}, collapsing
 * whitespace and reporting an empty one as absent. Exported because a host
 * that stores the generator's task state has to bound it the same way on the
 * way in — the prompt budgets against this length, so a host that invents its
 * own can quietly feed back more context than the generator planned for.
 */
declare function normalizeTaskSummary(raw: string): string | undefined;
/**
 * Projects a host's transcript onto the `recentMessages` title context: the
 * last `limit` messages that carry text, oldest first, with every non-user
 * role folded into `assistant`.
 *
 * Hosts model a transcript differently (questions, plans, tool activity), but
 * the title model only cares who was speaking, so the fold belongs here rather
 * than in each host. Callers pick the text for their own message kinds — a
 * plan message contributes its markdown, say — and pass `{role, text}` pairs.
 */
declare function toChatTitleMessages(messages: readonly {
  role: string;
  text: string;
}[], limit?: number): ChatTitleMessage[];
declare function fallbackChatTitle(prompt: string, attachmentNames?: readonly string[]): string;
declare function createChatTitleGenerator(options: ChatTitleGeneratorOptions): (input: ChatTitleInput) => Promise<ChatTitleResult>;
//#endregion
export { CHAT_TITLE_MAX_LENGTH, CHAT_TITLE_MODELS, CHAT_TITLE_RECENT_MESSAGE_LIMIT, CHAT_TITLE_TASK_MAX_LENGTH, type ChatEventBridge, type ChatEventBridgeOptions, type ChatTitleGeneratorOptions, type ChatTitleInput, type ChatTitleMessage, type ChatTitleProvider, type ChatTitleResult, type ChatTitleRunRequest, type ChatTitleRunResult, type ChatTitleRunner, type ChatTitleSource, type CompleteOptions, type TaskStore, type TaskStoreOptions, type TurnTask, createChatEventBridge, createChatTitleGenerator, createTaskStore, fallbackChatTitle, normalizeChatTitle, normalizeTaskSummary, toChatTitleMessages, toolCallDetails, toolTaskMetadata, truncateChatTitle };
//# sourceMappingURL=index.d.ts.map