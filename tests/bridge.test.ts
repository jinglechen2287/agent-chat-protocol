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

  describe("assistant text deltas", () => {
    const deltas = (events: ChatStreamEvent[]): string[] =>
      events.flatMap((ev) => (ev.type === "assistant_text_delta" ? [ev.delta] : []));

    const stream = (bridge: ReturnType<typeof createChatEventBridge>, chunks: string[]): void => {
      for (const chunk of chunks) bridge.callbacks.onAssistantTextDelta?.(chunk);
    };

    it("emits each fragment of prose as it arrives", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      stream(bridge, ["Hello", " there"]);
      expect(events).toEqual([
        { type: "assistant_text_delta", index: 0, delta: "Hello" },
        { type: "assistant_text_delta", index: 0, delta: " there" },
      ]);
    });

    it("advances the index for each completed message", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      stream(bridge, ["one"]);
      bridge.callbacks.onAssistantText?.("one");
      stream(bridge, ["two"]);
      bridge.callbacks.onAssistantText?.("two");
      expect(events).toEqual([
        { type: "assistant_text_delta", index: 0, delta: "one" },
        { type: "assistant_text", text: "one" },
        { type: "assistant_text_delta", index: 1, delta: "two" },
        { type: "assistant_text", text: "two" },
      ]);
    });

    // The completed message lifts the block into a question/controls event, so
    // streaming its raw JSON would flash markup that then disappears.
    it("stops emitting once an agent block fence opens", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      stream(bridge, ["Pick ", "one:\n", "``", "`agent-", "question\n", '{"question": "A?"}', "\n```"]);
      expect(deltas(events)).toEqual(["Pick ", "one:\n"]);
    });

    it("keeps streaming through an ordinary fenced code block", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      stream(bridge, ["Run:\n", "```sh\n", "bun test\n", "```\n", "Done."]);
      expect(deltas(events).join("")).toBe("Run:\n```sh\nbun test\n```\nDone.");
    });

    it("withholds a partial fence until its info string is known", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      stream(bridge, ["text\n", "``"]);
      expect(deltas(events).join("")).toBe("text\n");
      stream(bridge, ["`js\n"]);
      expect(deltas(events).join("")).toBe("text\n```js\n");
    });

    it("resumes streaming on the message after a suppressed one", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      stream(bridge, ["```agent-question\n", '{"question": "A?"}\n', "```"]);
      bridge.callbacks.onAssistantText?.('```agent-question\n{"question": "A?", "options": ["a", "b"]}\n```');
      stream(bridge, ["next message"]);
      expect(deltas(events)).toEqual(["next message"]);
    });

    it("ignores deltas that arrive after a terminal event", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      bridge.finish({ exitCode: 0 });
      stream(bridge, ["late"]);
      expect(deltas(events)).toEqual([]);
    });
  });

  describe("view blocks", () => {
    const viewBlock = [
      "```agent-view",
      '{"id":"root","type":"Stack","children":["t"]}',
      '{"id":"t","type":"Text","value":"All good."}',
      "```",
    ].join("\n");

    it("lifts a view block into text + view events, keeping surrounding prose", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      bridge.callbacks.onAssistantText?.(`Here is the summary.\n\n${viewBlock}`);
      expect(events.map((ev) => ev.type)).toEqual(["assistant_text", "view"]);
      expect(events[0]).toMatchObject({ text: "Here is the summary." });
      expect(events[1]).toMatchObject({
        spec: { components: [{ id: "root" }, { id: "t", value: "All good." }] },
      });
    });

    it("emits a view alongside a question block", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      bridge.callbacks.onAssistantText?.(
        `${viewBlock}\n\n\`\`\`agent-question\n{"question": "More?", "options": ["Yes", "No"]}\n\`\`\``,
      );
      expect(events.map((ev) => ev.type)).toEqual(["view", "question"]);
    });

    it("leaves an invalid view block in the prose", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      bridge.callbacks.onAssistantText?.("```agent-view\n{\"id\":\"t\",\"type\":\"Text\",\"value\":\"no root\"}\n```");
      expect(events.map((ev) => ev.type)).toEqual(["assistant_text"]);
    });

    it("withholds view fence deltas while streaming", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      for (const chunk of ["Report:\n", "```agent-", "view\n", '{"id":"root"...', "\n```"]) {
        bridge.callbacks.onAssistantTextDelta?.(chunk);
      }
      const streamed = events
        .flatMap((ev) => (ev.type === "assistant_text_delta" ? [ev.delta] : []))
        .join("");
      expect(streamed).toBe("Report:\n");
    });
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
    });
    bridge.callbacks.onAssistantText?.(
      "Here is a panel.\n\n```agent-controls\n" + spec + "\n```",
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("controls");
  });

  it("leaves a controls block in the prose when the app validator rejects it", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit, {
      controlsValidator: () => null,
    });
    const raw =
      "Here is a panel.\n\n```agent-controls\n" +
      JSON.stringify({
        controls: [
          { id: "r", type: "slider", label: "Radius", min: 0, max: 32, value: 8 },
        ],
      }) +
      "\n```";
    bridge.callbacks.onAssistantText?.(raw);
    expect(events).toEqual([{ type: "assistant_text", text: raw }]);
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

  it("emits normalized Codex plan items and their projected details", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    bridge.callbacks.onToolUse?.({
      callId: "todo-1",
      name: "TodoWrite",
      summary: "1/3 steps completed",
      planItems: [
        { text: "Inspect repository", status: "completed" },
        { text: "Implement support", status: "in_progress" },
        { text: "Verify tests", status: "pending" },
      ],
    });
    expect(events).toEqual([
      {
        type: "tool_use",
        name: "TodoWrite",
        summary: "1/3 steps completed",
        plan: [
          { text: "Inspect repository", status: "completed" },
          { text: "Implement support", status: "in_progress" },
          { text: "Verify tests", status: "pending" },
        ],
        details: [
          { label: "Completed", value: "Inspect repository" },
          { label: "In progress", value: "Implement support" },
          { label: "Pending", value: "Verify tests" },
        ],
      },
    ]);
  });

  it("waits for a TaskCreate result and emits its assigned id", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    bridge.callbacks.onToolUse?.({
      callId: "create-1",
      name: "TaskCreate",
      summary: "Ship task indicators",
      input: {
        subject: "Ship task indicators",
        description: "Show useful task details.",
        activeForm: "Shipping task indicators",
      },
    });
    expect(events).toEqual([]);

    bridge.callbacks.onToolResult?.({
      callId: "create-1",
      content: "Task #7 created successfully: Ship task indicators",
      isError: false,
    });

    expect(events).toEqual([
      {
        type: "tool_use",
        name: "TaskCreate",
        summary: "Ship task indicators",
        task: { id: "7", subject: "Ship task indicators" },
        details: [
          { label: "Task", value: "Ship task indicators" },
          { label: "Task ID", value: "7" },
          { label: "Description", value: "Show useful task details." },
          { label: "Active form", value: "Shipping task indicators" },
        ],
      },
    ]);
  });

  it("includes the known task subject on later TaskUpdate events", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    bridge.callbacks.onToolUse?.({
      callId: "create-1",
      name: "TaskCreate",
      summary: "Ship task indicators",
      input: { subject: "Ship task indicators" },
    });
    bridge.callbacks.onToolResult?.({
      callId: "create-1",
      content: "Task #7 created successfully: Ship task indicators",
    });
    bridge.callbacks.onToolUse?.({
      callId: "update-1",
      name: "TaskUpdate",
      summary: "Task #7 · in progress",
      input: { taskId: "7", status: "in_progress" },
    });

    expect(events.at(-1)).toEqual({
      type: "tool_use",
      name: "TaskUpdate",
      summary: "Task #7 · in progress",
      task: { id: "7", subject: "Ship task indicators", status: "in_progress" },
      details: [
        { label: "Task", value: "Ship task indicators" },
        { label: "Task ID", value: "7" },
        { label: "Status", value: "In progress" },
      ],
    });
  });

  it("flushes TaskCreate without an id before the terminal event when no result arrives", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    bridge.callbacks.onToolUse?.({
      callId: "create-1",
      name: "TaskCreate",
      summary: "Ship task indicators",
      input: { subject: "Ship task indicators" },
    });
    bridge.finish({ exitCode: 0 });
    expect(events).toEqual([
      {
        type: "tool_use",
        name: "TaskCreate",
        summary: "Ship task indicators",
        task: { subject: "Ship task indicators" },
        details: [{ label: "Task", value: "Ship task indicators" }],
      },
      { type: "done", exitCode: 0 },
    ]);
  });

  it("forwards a usage snapshot as context_usage, dropping absent fields", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    bridge.callbacks.onUsage?.({
      contextTokens: 21591,
      inputTokens: 2,
      cachedInputTokens: 15099,
      outputTokens: 6,
      model: "claude-opus-4-8[1m]",
      contextWindow: 1_000_000,
    });
    bridge.callbacks.onUsage?.({
      contextTokens: 4004,
      inputTokens: 4004,
      cachedInputTokens: 0,
      outputTokens: 10,
    });
    expect(events).toEqual([
      {
        type: "context_usage",
        contextTokens: 21591,
        contextWindow: 1_000_000,
        model: "claude-opus-4-8[1m]",
      },
      { type: "context_usage", contextTokens: 4004 },
    ]);
  });

  it("forwards stderr chunks", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    bridge.callbacks.onStderr?.("warning: x\n");
    expect(events).toEqual([{ type: "stderr", chunk: "warning: x\n" }]);
  });

  it("forwards background-agent lifecycle snapshots as mutable events", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    bridge.callbacks.onBackgroundAgentUpdate?.({
      id: "agent-thread",
      provider: "codex",
      parentToolCallId: "collab-1",
      description: "Inspect authentication",
      agentType: "explorer",
      status: "running",
      summary: "Checking middleware",
      progress: {
        totalTokens: 1200,
        toolUses: 4,
        durationMs: 900,
        lastToolName: "Grep",
      },
      startedAt: 1_000,
      updatedAt: 2_000,
    });
    expect(events).toEqual([{
      type: "background_agent_updated",
      agent: {
        id: "agent-thread",
        provider: "codex",
        parentToolCallId: "collab-1",
        description: "Inspect authentication",
        agentType: "explorer",
        status: "running",
        summary: "Checking middleware",
        progress: {
          totalTokens: 1200,
          toolUses: 4,
          durationMs: 900,
          lastToolName: "Grep",
        },
        startedAt: 1_000,
        updatedAt: 2_000,
      },
    }]);
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
