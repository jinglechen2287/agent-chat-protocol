import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type ChatStreamEvent } from "../src/index";
import { createChatEventBridge } from "../src/server/index";

const session = (sessionId: string): ChatStreamEvent => ({
  type: "session_started",
  sessionId,
  protocolVersion: PROTOCOL_VERSION,
});

const collect = (): { events: ChatStreamEvent[]; emit: (ev: ChatStreamEvent) => void } => {
  const events: ChatStreamEvent[] = [];
  return { events, emit: (ev) => events.push(ev) };
};

describe("createChatEventBridge", () => {
  it("announces a preset session id immediately, with the protocol version", () => {
    const { events, emit } = collect();
    createChatEventBridge(emit, { presetSessionId: "pre-1" });
    expect(events).toEqual([session("pre-1")]);
  });

  it("suppresses the runner reporting the same session id", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit, { presetSessionId: "pre-1" });
    bridge.callbacks.onSessionId?.("pre-1");
    expect(events).toHaveLength(1);
  });

  it("re-announces when the runner reports a different id", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit, { presetSessionId: "pre-1" });
    bridge.callbacks.onSessionId?.("actual-2");
    expect(events).toEqual([session("pre-1"), session("actual-2")]);
  });

  it("announces the runner-reported id when no preset exists, once", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    bridge.callbacks.onSessionId?.("s1");
    bridge.callbacks.onSessionId?.("s1");
    expect(events).toEqual([session("s1")]);
  });

  it("does not re-announce a known session id on a resumed turn", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit, { knownSessionId: "s1" });
    bridge.callbacks.onSessionId?.("s1");
    expect(events).toEqual([]);
  });

  it("announces a changed session id even on a resumed turn", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit, { knownSessionId: "s1" });
    bridge.callbacks.onSessionId?.("s2");
    expect(events).toEqual([session("s2")]);
  });

  it("emits plain assistant text as assistant_text", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    bridge.callbacks.onAssistantText?.("Just prose.");
    expect(events).toEqual([{ type: "assistant_text", text: "Just prose." }]);
  });

  it("lifts a question block into text + question events", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    bridge.callbacks.onAssistantText?.(
      'Two options here.\n\n```agent-question\n{"question": "Which?", "options": ["A", "B"]}\n```',
    );
    expect(events).toEqual([
      { type: "assistant_text", text: "Two options here." },
      { type: "question", question: "Which?", options: ["A", "B"] },
    ]);
  });

  it("suppresses surrounding prose when a controls block is valid", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    const spec = JSON.stringify({
      controls: [
        { id: "r", type: "slider", label: "Radius", min: 0, max: 32, value: 8 },
      ],
      styles: [{ property: "border-radius", template: "{r}" }],
    });
    bridge.callbacks.onAssistantText?.(
      "Here is a panel.\n\n```agent-controls\n" + spec + "\n```",
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("controls");
  });

  it("emits tool_use with projected details", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    bridge.callbacks.onToolUse?.({
      name: "Bash",
      summary: "bun test",
      input: { command: "bun test" },
    });
    expect(events).toEqual([
      {
        type: "tool_use",
        name: "Bash",
        summary: "bun test",
        details: [{ label: "Command", value: "bun test" }],
      },
    ]);
  });

  it("omits empty details from tool_use", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    bridge.callbacks.onToolUse?.({ name: "Mystery" });
    expect(events).toEqual([{ type: "tool_use", name: "Mystery" }]);
  });

  it("forwards stderr chunks", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    bridge.callbacks.onStderr?.("warning: x\n");
    expect(events).toEqual([{ type: "stderr", chunk: "warning: x\n" }]);
  });

  it("finish emits done with the exit code", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    bridge.finish({ exitCode: 0 });
    expect(events).toEqual([{ type: "done", exitCode: 0 }]);
  });

  it("fail maps AbortError to a user abort", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    const err = new Error("aborted");
    err.name = "AbortError";
    bridge.fail(err);
    expect(events).toEqual([{ type: "aborted", reason: "user" }]);
  });

  it("fail maps TimeoutError to a timeout abort", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    const err = new Error("timed out");
    err.name = "TimeoutError";
    bridge.fail(err);
    expect(events).toEqual([{ type: "aborted", reason: "timeout" }]);
  });

  it("emits exactly one terminal event even when finish and fail both fire", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    bridge.finish({ exitCode: 0 });
    bridge.fail(new Error("late failure"));
    bridge.finish({ exitCode: 1 });
    expect(events).toEqual([{ type: "done", exitCode: 0 }]);
  });

  it("fail maps anything else to an error event", () => {
    const first = collect();
    createChatEventBridge(first.emit).fail(new Error("boom"));
    expect(first.events).toEqual([{ type: "error", message: "boom" }]);

    const second = collect();
    createChatEventBridge(second.emit).fail("string failure");
    expect(second.events).toEqual([{ type: "error", message: "string failure" }]);
  });
});
