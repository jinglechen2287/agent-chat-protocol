/**
 * In-memory registry of in-flight turns, keyed by client-supplied turn id.
 * Survives client disconnects so a refresh (or a phone waking up) can
 * reattach to the same run instead of killing it: replay `task.events`, then
 * `subscribe` for live ones — push is synchronous, so done in one tick there
 * is no gap between replay and subscription.
 *
 * Completed tasks linger for a TTL so a reattach shortly after the turn
 * finishes still finds the buffered terminal event.
 */

import type { ChatStreamEvent } from "../events";

export interface TurnTask {
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

export interface TaskStoreOptions {
  /** How long a completed task stays reattachable. Default 5 minutes. */
  completeTtlMs?: number;
}

export interface CompleteOptions {
  /** Overrides the store-level TTL for this task. */
  ttlMs?: number;
}

type AssistantTextDelta = Extract<ChatStreamEvent, { type: "assistant_text_delta" }>;

/** The events an in-flight assistant message resolves into. Once one is
 * buffered, every fragment held so far describes text the transcript now owns. */
function completesAssistantMessage(ev: ChatStreamEvent): boolean {
  return ev.type === "assistant_text" || ev.type === "question" || ev.type === "controls";
}

export interface TaskStore {
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

const DEFAULT_COMPLETE_TTL_MS = 5 * 60_000;

/** Iterates a snapshot so a subscriber unsubscribing mid-notification doesn't
 * cause its peers to be skipped, and a broken one can't block the rest. */
function notify(task: TurnTask, ev: ChatStreamEvent): void {
  for (const sub of [...task.subscribers]) {
    try {
      sub(ev);
    } catch {
      // A broken subscriber must not block buffer growth or other listeners.
    }
  }
}

export function createTaskStore(options: TaskStoreOptions = {}): TaskStore {
  const defaultTtl = options.completeTtlMs ?? DEFAULT_COMPLETE_TTL_MS;
  const tasks = new Map<string, TurnTask>();

  return {
    get(id) {
      return tasks.get(id);
    },

    create(id) {
      const existing = tasks.get(id);
      if (existing) return existing;
      const task: TurnTask = {
        id,
        events: [],
        partials: new Map(),
        done: false,
        abort: new AbortController(),
        subscribers: new Set(),
      };
      tasks.set(id, task);
      return task;
    },

    push(task, ev) {
      // Ignore stale handles (task deleted or replaced) and late callbacks
      // arriving after completion — a terminal event must be the last thing
      // in the buffer, and replaced ids must not receive the old run's events.
      if (task.done || tasks.get(task.id) !== task) return;
      if (completesAssistantMessage(ev)) task.partials.clear();
      task.events.push(ev);
      notify(task, ev);
    },

    pushPartial(task, ev) {
      if (task.done || tasks.get(task.id) !== task) return;
      task.partials.set(ev.index, (task.partials.get(ev.index) ?? "") + ev.delta);
      notify(task, ev);
    },

    pendingPartials(task) {
      return [...task.partials.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, delta]) => ({ type: "assistant_text_delta", index, delta }));
    },

    subscribe(task, listener) {
      task.subscribers.add(listener);
      return () => {
        task.subscribers.delete(listener);
      };
    },

    complete(task, completeOptions = {}) {
      if (task.done) return;
      task.done = true;
      // The buffered terminal event and the persisted transcript are now
      // authoritative; nothing should replay half-written text over them.
      task.partials.clear();
      const ttl = completeOptions.ttlMs ?? defaultTtl;
      task.cleanupTimer = setTimeout(() => {
        tasks.delete(task.id);
      }, ttl);
    },

    cancel(id) {
      const task = tasks.get(id);
      if (!task) return false;
      task.abort.abort();
      return true;
    },

    delete(id) {
      const task = tasks.get(id);
      if (!task) return;
      if (task.cleanupTimer) {
        clearTimeout(task.cleanupTimer);
        delete task.cleanupTimer;
      }
      tasks.delete(id);
    },
  };
}
