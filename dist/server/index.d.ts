import { i as ToolCallDetail, l as ControlsSpec, n as ChatStreamEvent } from "../events-CwMSwgnb.js";
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
  /** Wire these into the runner's run options (all four callbacks). */
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
interface TaskStore {
  get(id: string): TurnTask | undefined;
  /** Returns the existing task when the id is already registered. */
  create(id: string): TurnTask;
  /** Buffers the event and notifies current subscribers. */
  push(task: TurnTask, ev: ChatStreamEvent): void;
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
/**
 * Reduce provider-specific raw tool input to the useful values the transcript
 * should retain.
 */
declare function toolCallDetails(info: ToolUseInfo): ToolCallDetail[];
//#endregion
export { type ChatEventBridge, type ChatEventBridgeOptions, type CompleteOptions, type TaskStore, type TaskStoreOptions, type TurnTask, createChatEventBridge, createTaskStore, toolCallDetails };
//# sourceMappingURL=index.d.ts.map