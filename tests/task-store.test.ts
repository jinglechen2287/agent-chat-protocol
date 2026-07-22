import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent } from "../src/index";
import { createTaskStore } from "../src/server/index";

const textEvent = (text: string): ChatStreamEvent => ({
  type: "assistant_text",
  text,
});

const deltaEvent = (
  index: number,
  delta: string,
): Extract<ChatStreamEvent, { type: "assistant_text_delta" }> => ({
  type: "assistant_text_delta",
  index,
  delta,
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

  describe("streamed text fragments", () => {
    it("notifies subscribers without entering the replay buffer", () => {
      const store = createTaskStore();
      const task = store.create("t1");
      const seen: ChatStreamEvent[] = [];
      store.subscribe(task, (ev) => seen.push(ev));
      store.pushPartial(task, deltaEvent(0, "Hel"));
      store.pushPartial(task, deltaEvent(0, "lo"));
      expect(seen).toEqual([deltaEvent(0, "Hel"), deltaEvent(0, "lo")]);
      expect(task.events).toEqual([]);
    });

    it("hands a late subscriber the accumulated text as one fragment", () => {
      const store = createTaskStore();
      const task = store.create("t1");
      store.pushPartial(task, deltaEvent(0, "Hel"));
      store.pushPartial(task, deltaEvent(0, "lo"));
      expect(store.pendingPartials(task)).toEqual([deltaEvent(0, "Hello")]);
    });

    it("keeps fragments for different messages apart, in index order", () => {
      const store = createTaskStore();
      const task = store.create("t1");
      store.pushPartial(task, deltaEvent(1, "second"));
      store.pushPartial(task, deltaEvent(0, "first"));
      expect(store.pendingPartials(task)).toEqual([
        deltaEvent(0, "first"),
        deltaEvent(1, "second"),
      ]);
    });

    // The completed message is in the replay buffer, so replaying its
    // fragments too would render the text twice.
    it("drops a message's fragments once its assistant_text is buffered", () => {
      const store = createTaskStore();
      const task = store.create("t1");
      store.pushPartial(task, deltaEvent(0, "Hello"));
      store.push(task, textEvent("Hello"));
      store.pushPartial(task, deltaEvent(1, "next"));
      expect(store.pendingPartials(task)).toEqual([deltaEvent(1, "next")]);
    });

    it("ignores fragments after completion or through a stale handle", () => {
      const store = createTaskStore();
      const stale = store.create("t1");
      store.delete("t1");
      const replacement = store.create("t1");
      store.pushPartial(stale, deltaEvent(0, "from old run"));
      expect(store.pendingPartials(stale)).toEqual([]);
      store.complete(replacement);
      store.pushPartial(replacement, deltaEvent(0, "late"));
      expect(store.pendingPartials(replacement)).toEqual([]);
    });
  });

  describe("streamed view lines", () => {
    const line = (
      index: number,
      id: string,
    ): Extract<ChatStreamEvent, { type: "view_line" }> => ({
      type: "view_line",
      index,
      component: { id, type: "Divider" },
    });

    it("notifies subscribers without entering the replay buffer", () => {
      const store = createTaskStore();
      const task = store.create("t1");
      const seen: ChatStreamEvent[] = [];
      store.subscribe(task, (ev) => seen.push(ev));
      store.pushViewLine(task, line(0, "root"));
      expect(seen).toEqual([line(0, "root")]);
      expect(task.events).toEqual([]);
    });

    it("replays accumulated lines to a late subscriber in arrival order", () => {
      const store = createTaskStore();
      const task = store.create("t1");
      store.pushViewLine(task, line(0, "root"));
      store.pushViewLine(task, line(0, "s1"));
      expect(store.pendingViewLines(task)).toEqual([line(0, "root"), line(0, "s1")]);
    });

    it("drops a message's lines once its view (or text) is buffered", () => {
      const store = createTaskStore();
      const task = store.create("t1");
      store.pushViewLine(task, line(0, "root"));
      store.push(task, {
        type: "view",
        spec: { components: [{ id: "root", type: "Divider" }] },
      });
      expect(store.pendingViewLines(task)).toEqual([]);
    });
  });

  describe("streamed html deltas", () => {
    const delta = (
      index: number,
      chunk: string,
    ): Extract<ChatStreamEvent, { type: "html_delta" }> => ({
      type: "html_delta",
      index,
      delta: chunk,
    });

    it("notifies subscribers without entering the replay buffer", () => {
      const store = createTaskStore();
      const task = store.create("t1");
      const seen: ChatStreamEvent[] = [];
      store.subscribe(task, (ev) => seen.push(ev));
      store.pushHtmlDelta(task, delta(0, "<p>a</p>\n"));
      expect(seen).toEqual([delta(0, "<p>a</p>\n")]);
      expect(task.events).toEqual([]);
    });

    it("hands a late subscriber the accumulated html as one delta per index", () => {
      const store = createTaskStore();
      const task = store.create("t1");
      store.pushHtmlDelta(task, delta(0, "<p>a</p>\n"));
      store.pushHtmlDelta(task, delta(0, "<p>b</p>\n"));
      expect(store.pendingHtmlDeltas(task)).toEqual([delta(0, "<p>a</p>\n<p>b</p>\n")]);
    });

    it("drops a message's deltas once its html (or text) is buffered", () => {
      const store = createTaskStore();
      const task = store.create("t1");
      store.pushHtmlDelta(task, delta(0, "<p>a</p>\n"));
      store.push(task, { type: "html", content: "<p>a</p>" });
      expect(store.pendingHtmlDeltas(task)).toEqual([]);
    });
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
