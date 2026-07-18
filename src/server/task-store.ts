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

export interface TaskStore {
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

const DEFAULT_COMPLETE_TTL_MS = 5 * 60_000;

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
        done: false,
        abort: new AbortController(),
        subscribers: new Set(),
      };
      tasks.set(id, task);
      return task;
    },

    push(task, ev) {
      task.events.push(ev);
      // Snapshot so a subscriber unsubscribing during iteration doesn't skip
      // peers.
      for (const sub of [...task.subscribers]) {
        try {
          sub(ev);
        } catch {
          // A broken subscriber must not block buffer growth or other
          // listeners.
        }
      }
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
