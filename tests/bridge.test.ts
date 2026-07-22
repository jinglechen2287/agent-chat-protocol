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

    it("emits each completed view line as a view_line event, split across chunks", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      for (const chunk of [
        "Report:\n```agent-view\n",
        '{"id":"root","type":"Stack",',
        '"children":["s1"]}\n{"id":"s1","type":"Stat",',
        '"label":"Uptime","value":"99.9%"}\n',
        "```",
      ]) {
        bridge.callbacks.onAssistantTextDelta?.(chunk);
      }
      const lines = events.filter((ev) => ev.type === "view_line");
      expect(lines).toEqual([
        {
          type: "view_line",
          index: 0,
          component: { id: "root", type: "Stack", children: ["s1"] },
        },
        {
          type: "view_line",
          index: 0,
          component: { id: "s1", type: "Stat", label: "Uptime", value: "99.9%" },
        },
      ]);
    });

    it("skips malformed and unknown view lines without dropping the stream", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      for (const chunk of [
        "```agent-view\n",
        "{not json\n",
        '{"id":"x","type":"Hologram"}\n',
        '{"id":"root","type":"Divider"}\n',
      ]) {
        bridge.callbacks.onAssistantTextDelta?.(chunk);
      }
      const lines = events.filter((ev) => ev.type === "view_line");
      expect(lines).toEqual([
        { type: "view_line", index: 0, component: { id: "root", type: "Divider" } },
      ]);
    });

    it("does not emit view_line events for question or controls blocks", () => {
      const blocks = [
        ["```agent-question\n", '{"question": "A?"}\n', "```"],
        [
          "```agent-controls\n",
          '{"controls": [{"id": "size", "type": "slider", "label": "Size", "min": 0, "max": 10, "value": 5}]}\n',
          "```",
        ],
      ];
      for (const chunks of blocks) {
        const { events, emit } = collect();
        const bridge = createChatEventBridge(emit);
        for (const chunk of chunks) bridge.callbacks.onAssistantTextDelta?.(chunk);
        expect(events.filter((ev) => ev.type === "view_line")).toEqual([]);
      }
    });

    it("carries the message index on view lines from later messages", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      bridge.callbacks.onAssistantText?.("first message");
      bridge.callbacks.onAssistantTextDelta?.('```agent-view\n{"id":"root","type":"Divider"}\n');
      const lines = events.filter((ev) => ev.type === "view_line");
      expect(lines).toEqual([
        { type: "view_line", index: 1, component: { id: "root", type: "Divider" } },
      ]);
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

  it("lifts a proposed_plan block into text + plan events", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    bridge.callbacks.onAssistantText?.(
      "Plan is ready.\n\n<proposed_plan>\n# Add subtract\n\nBody.\n</proposed_plan>",
    );
    expect(events).toEqual([
      { type: "assistant_text", text: "Plan is ready." },
      { type: "plan", planMarkdown: "# Add subtract\n\nBody.", title: "Add subtract" },
    ]);
  });

  it("emits only the plan event when the message is nothing but the block", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    bridge.callbacks.onAssistantText?.("<proposed_plan>\n# T\nBody.\n</proposed_plan>");
    expect(events).toEqual([
      { type: "plan", planMarkdown: "# T\nBody.", title: "T" },
    ]);
  });

  it("does not mis-lift a question fence inside a plan body", () => {
    const { events, emit } = collect();
    const bridge = createChatEventBridge(emit);
    bridge.callbacks.onAssistantText?.(
      "<proposed_plan>\n# T\n\n```agent-question\n" +
        '{"question": "Q?", "options": ["A", "B"]}\n```\n</proposed_plan>',
    );
    expect(events.map((ev) => ev.type)).toEqual(["plan"]);
    expect(events[0]).toMatchObject({ type: "plan", title: "T" });
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

  describe("html blocks", () => {
    const doc = "<!doctype html>\n<html><body>\n  <h1>Hi</h1>\n</body></html>";
    const htmlBlock = ["```agent-html", doc, "```"].join("\n");

    const htmlDeltas = (events: ChatStreamEvent[]): string =>
      events.flatMap((ev) => (ev.type === "html_delta" ? [ev.delta] : [])).join("");

    it("lifts an html block into text + html events, keeping surrounding prose", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      bridge.callbacks.onAssistantText?.(`Here is the page.\n\n${htmlBlock}`);
      expect(events.map((ev) => ev.type)).toEqual(["assistant_text", "html"]);
      expect(events[0]).toMatchObject({ text: "Here is the page." });
      expect(events[1]).toEqual({ type: "html", content: doc });
    });

    it("leaves an empty html block in the prose", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      const raw = "```agent-html\n  \n```";
      bridge.callbacks.onAssistantText?.(raw);
      expect(events).toEqual([{ type: "assistant_text", text: raw }]);
    });

    it("emits an html event alongside a question block", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      bridge.callbacks.onAssistantText?.(
        `${htmlBlock}\n\n\`\`\`agent-question\n{"question": "More?", "options": ["Yes", "No"]}\n\`\`\``,
      );
      expect(events.map((ev) => ev.type)).toEqual(["html", "question"]);
    });

    it("withholds html fence deltas from the text stream while emitting html_delta lines", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      for (const chunk of [
        "Page:\n",
        "```agent-",
        "html\n<!doctype html>\n<html><bo",
        "dy>\n  <h1>H",
        "i</h1>\n\n</body></html>\n",
        "```",
      ]) {
        bridge.callbacks.onAssistantTextDelta?.(chunk);
      }
      const prose = events
        .flatMap((ev) => (ev.type === "assistant_text_delta" ? [ev.delta] : []))
        .join("");
      expect(prose).toBe("Page:\n");
      // Deltas preserve indentation and blank lines; each completed line
      // arrives newline-terminated, and the closing fence is never included.
      expect(htmlDeltas(events)).toBe(
        "<!doctype html>\n<html><body>\n  <h1>Hi</h1>\n\n</body></html>\n",
      );
    });

    it("stops emitting html deltas at the closing fence", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      for (const chunk of ["```agent-html\n<p>x</p>\n```\nafter"]) {
        bridge.callbacks.onAssistantTextDelta?.(chunk);
      }
      expect(htmlDeltas(events)).toBe("<p>x</p>\n");
    });

    it("streams content lines that open a nested fence", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      bridge.callbacks.onAssistantTextDelta?.("```agent-html\n<pre>\n```js\ncode\n</pre>\n```");
      expect(htmlDeltas(events)).toBe("<pre>\n```js\ncode\n</pre>\n");
    });

    it("carries the message index on html deltas", () => {
      const { events, emit } = collect();
      const bridge = createChatEventBridge(emit);
      bridge.callbacks.onAssistantText?.("First message.");
      bridge.callbacks.onAssistantTextDelta?.("```agent-html\n<p>x</p>\n");
      const deltas = events.filter((ev) => ev.type === "html_delta");
      expect(deltas).toEqual([{ type: "html_delta", index: 1, delta: "<p>x</p>\n" }]);
    });
  });
});
