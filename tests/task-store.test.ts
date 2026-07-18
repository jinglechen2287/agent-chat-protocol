import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent } from "../src/index";
import { createTaskStore } from "../src/server/index";

const textEvent = (text: string): ChatStreamEvent => ({
  type: "assistant_text",
  text,
});

describe("createTaskStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a task once and returns the same instance after", () => {
    const store = createTaskStore();
    const task = store.create("t1");
    expect(store.create("t1")).toBe(task);
    expect(store.get("t1")).toBe(task);
    expect(store.get("nope")).toBeUndefined();
  });

  it("buffers pushed events and notifies subscribers", () => {
    const store = createTaskStore();
    const task = store.create("t1");
    const seen: ChatStreamEvent[] = [];
    const unsub = store.subscribe(task, (ev) => seen.push(ev));
    store.push(task, textEvent("a"));
    unsub();
    store.push(task, textEvent("b"));
    expect(seen).toEqual([textEvent("a")]);
    expect(task.events).toEqual([textEvent("a"), textEvent("b")]);
  });

  it("a throwing subscriber does not block others or the buffer", () => {
    const store = createTaskStore();
    const task = store.create("t1");
    const seen: ChatStreamEvent[] = [];
    store.subscribe(task, () => {
      throw new Error("broken");
    });
    store.subscribe(task, (ev) => seen.push(ev));
    store.push(task, textEvent("a"));
    expect(seen).toEqual([textEvent("a")]);
    expect(task.events).toHaveLength(1);
  });

  it("complete marks done and drops the task after the TTL", () => {
    const store = createTaskStore({ completeTtlMs: 1000 });
    const task = store.create("t1");
    store.complete(task);
    expect(task.done).toBe(true);
    expect(store.get("t1")).toBe(task);
    vi.advanceTimersByTime(999);
    expect(store.get("t1")).toBe(task);
    vi.advanceTimersByTime(1);
    expect(store.get("t1")).toBeUndefined();
  });

  it("cancel aborts the task signal and reports whether it existed", () => {
    const store = createTaskStore();
    const task = store.create("t1");
    expect(task.abort.signal.aborted).toBe(false);
    expect(store.cancel("t1")).toBe(true);
    expect(task.abort.signal.aborted).toBe(true);
    expect(store.cancel("nope")).toBe(false);
  });

  it("delete removes the task and clears any pending cleanup timer", () => {
    const store = createTaskStore({ completeTtlMs: 1000 });
    const task = store.create("t1");
    store.complete(task);
    store.delete("t1");
    expect(store.get("t1")).toBeUndefined();
    // A recreated task under the same id must not be reaped by the old timer.
    const replacement = store.create("t1");
    vi.advanceTimersByTime(2000);
    expect(store.get("t1")).toBe(replacement);
  });

  it("ignores pushes after completion", () => {
    const store = createTaskStore();
    const task = store.create("t1");
    store.push(task, textEvent("a"));
    store.complete(task);
    store.push(task, textEvent("late"));
    expect(task.events).toEqual([textEvent("a")]);
  });

  it("ignores pushes through a stale handle after delete and recreate", () => {
    const store = createTaskStore();
    const stale = store.create("t1");
    store.delete("t1");
    const replacement = store.create("t1");
    store.push(stale, textEvent("from old run"));
    expect(stale.events).toEqual([]);
    expect(replacement.events).toEqual([]);
    store.push(replacement, textEvent("current"));
    expect(replacement.events).toEqual([textEvent("current")]);
  });
});
