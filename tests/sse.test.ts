import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  isTerminalEvent,
  type ChatStreamEvent,
} from "../src/index";
import {
  consumeSseResponse,
  encodeChatEvent,
  formatSseEvent,
  mapSseToChatEvent,
  parseSseBuffer,
  toSseEvent,
} from "../src/index";

describe("parseSseBuffer", () => {
  it("parses a complete event block and returns the trailing remainder", () => {
    const result = parseSseBuffer(
      'event: assistant_text\ndata: {"text":"hi"}\n\nevent: done\ndata: {"exi',
    );
    expect(result.events).toEqual([
      { event: "assistant_text", data: { text: "hi" } },
    ]);
    expect(result.remainder).toBe('event: done\ndata: {"exi');
  });

  it("parses multiple events from one buffer", () => {
    const result = parseSseBuffer(
      'event: a\ndata: {"x":1}\n\nevent: b\ndata: {"y":2}\n\n',
    );
    expect(result.events).toHaveLength(2);
    expect(result.remainder).toBe("");
  });

  it("joins multi-line data before JSON parsing", () => {
    const result = parseSseBuffer('event: a\ndata: {"x":\ndata: 1}\n\n');
    expect(result.events).toEqual([{ event: "a", data: { x: 1 } }]);
  });

  it("leaves non-JSON data as a string", () => {
    const result = parseSseBuffer("event: a\ndata: plain text\n\n");
    expect(result.events).toEqual([{ event: "a", data: "plain text" }]);
  });

  it("defaults the event name to message", () => {
    const result = parseSseBuffer('data: {"x":1}\n\n');
    expect(result.events).toEqual([{ event: "message", data: { x: 1 } }]);
  });

  it("skips blocks with no data lines", () => {
    const result = parseSseBuffer("event: a\n\n");
    expect(result.events).toEqual([]);
  });

  it("accepts CRLF framing and line endings", () => {
    const result = parseSseBuffer(
      'event: assistant_text\r\ndata: {"text":"hi"}\r\n\r\nevent: done\r\ndata: {',
    );
    expect(result.events).toEqual([
      { event: "assistant_text", data: { text: "hi" } },
    ]);
    expect(result.remainder).toBe("event: done\r\ndata: {");
  });

  it("strips only the single optional space after the data colon", () => {
    const result = parseSseBuffer("data:  padded \n\n");
    expect(result.events).toEqual([{ event: "message", data: " padded " }]);
  });
});

describe("mapSseToChatEvent", () => {
  it("maps session_started", () => {
    expect(
      mapSseToChatEvent({ event: "session_started", data: { sessionId: "s1" } }),
    ).toEqual({ type: "session_started", sessionId: "s1" });
  });

  it("carries protocolVersion through session_started when present", () => {
    expect(
      mapSseToChatEvent({
        event: "session_started",
        data: { sessionId: "s1", protocolVersion: 1 },
      }),
    ).toEqual({ type: "session_started", sessionId: "s1", protocolVersion: 1 });
  });

  it("rejects session_started without a string sessionId", () => {
    expect(mapSseToChatEvent({ event: "session_started", data: {} })).toBeNull();
  });

  it("maps assistant_text", () => {
    expect(
      mapSseToChatEvent({ event: "assistant_text", data: { text: "hello" } }),
    ).toEqual({ type: "assistant_text", text: "hello" });
  });

  it("maps tool_use with optional summary and details", () => {
    expect(mapSseToChatEvent({ event: "tool_use", data: { name: "Bash" } })).toEqual(
      { type: "tool_use", name: "Bash" },
    );
    expect(
      mapSseToChatEvent({
        event: "tool_use",
        data: {
          name: "Bash",
          summary: "bun test",
          details: [{ label: "Command", value: "bun test" }],
        },
      }),
    ).toEqual({
      type: "tool_use",
      name: "Bash",
      summary: "bun test",
      details: [{ label: "Command", value: "bun test" }],
    });
  });

  it("maps optional task metadata on tool_use", () => {
    expect(
      mapSseToChatEvent({
        event: "tool_use",
        data: {
          name: "TaskUpdate",
          task: { id: "7", subject: "Ship task indicators", status: "completed" },
        },
      }),
    ).toEqual({
      type: "tool_use",
      name: "TaskUpdate",
      task: { id: "7", subject: "Ship task indicators", status: "completed" },
    });
  });

  it("preserves empty tool_use details arrays", () => {
    expect(
      mapSseToChatEvent({ event: "tool_use", data: { name: "Bash", details: [] } }),
    ).toEqual({ type: "tool_use", name: "Bash", details: [] });
  });

  it("drops malformed tool_use details but keeps the event", () => {
    expect(
      mapSseToChatEvent({
        event: "tool_use",
        data: { name: "Bash", details: [{ label: 1 }] },
      }),
    ).toEqual({ type: "tool_use", name: "Bash" });
  });

  it("maps question", () => {
    expect(
      mapSseToChatEvent({
        event: "question",
        data: { question: "Which?", options: ["A", "B"] },
      }),
    ).toEqual({ type: "question", question: "Which?", options: ["A", "B"] });
  });

  it("maps controls through the core validator, dropping extension fields", () => {
    const spec = {
      controls: [
        {
          id: "radius",
          type: "slider",
          label: "Radius",
          min: 0,
          max: 32,
          unit: "px",
          value: 8,
        },
      ],
      styles: [{ property: "border-radius", template: "{radius}" }],
    };
    const mapped = mapSseToChatEvent({ event: "controls", data: spec });
    expect(mapped?.type).toBe("controls");
    if (mapped?.type === "controls") {
      expect(mapped.spec.controls[0]?.id).toBe("radius");
      expect("styles" in mapped.spec).toBe(false);
    }
  });

  it("rejects an invalid controls payload", () => {
    expect(
      mapSseToChatEvent({ event: "controls", data: { controls: [] } }),
    ).toBeNull();
  });

  it("maps stderr", () => {
    expect(mapSseToChatEvent({ event: "stderr", data: { chunk: "warn\n" } })).toEqual(
      { type: "stderr", chunk: "warn\n" },
    );
  });

  it("maps context_usage with optional window and model", () => {
    expect(
      mapSseToChatEvent({
        event: "context_usage",
        data: { contextTokens: 21591, contextWindow: 1_000_000, model: "claude-opus-4-8[1m]" },
      }),
    ).toEqual({
      type: "context_usage",
      contextTokens: 21591,
      contextWindow: 1_000_000,
      model: "claude-opus-4-8[1m]",
    });
    expect(
      mapSseToChatEvent({ event: "context_usage", data: { contextTokens: 100 } }),
    ).toEqual({ type: "context_usage", contextTokens: 100 });
  });

  it("rejects context_usage without a numeric contextTokens", () => {
    expect(
      mapSseToChatEvent({ event: "context_usage", data: { contextWindow: 200000 } }),
    ).toBeNull();
  });

  it("rejects negative or fractional context token counts", () => {
    expect(
      mapSseToChatEvent({ event: "context_usage", data: { contextTokens: -1 } }),
    ).toBeNull();
    expect(
      mapSseToChatEvent({ event: "context_usage", data: { contextTokens: 1.5 } }),
    ).toBeNull();
  });

  it("drops an empty or non-string model but keeps the event", () => {
    expect(
      mapSseToChatEvent({
        event: "context_usage",
        data: { contextTokens: 100, model: "" },
      }),
    ).toEqual({ type: "context_usage", contextTokens: 100 });
    expect(
      mapSseToChatEvent({
        event: "context_usage",
        data: { contextTokens: 100, model: "   " },
      }),
    ).toEqual({ type: "context_usage", contextTokens: 100 });
    expect(
      mapSseToChatEvent({
        event: "context_usage",
        data: { contextTokens: 100, model: 42 },
      }),
    ).toEqual({ type: "context_usage", contextTokens: 100 });
  });

  it("drops a non-positive or fractional contextWindow but keeps the event", () => {
    expect(
      mapSseToChatEvent({
        event: "context_usage",
        data: { contextTokens: 100, contextWindow: 0 },
      }),
    ).toEqual({ type: "context_usage", contextTokens: 100 });
    expect(
      mapSseToChatEvent({
        event: "context_usage",
        data: { contextTokens: 100, contextWindow: 200_000.5 },
      }),
    ).toEqual({ type: "context_usage", contextTokens: 100 });
  });

  it("maps done with a fallback exit code", () => {
    expect(mapSseToChatEvent({ event: "done", data: { exitCode: 0 } })).toEqual({
      type: "done",
      exitCode: 0,
    });
    expect(mapSseToChatEvent({ event: "done", data: {} })).toEqual({
      type: "done",
      exitCode: -1,
    });
  });

  it("maps aborted with an optional reason", () => {
    expect(mapSseToChatEvent({ event: "aborted", data: {} })).toEqual({
      type: "aborted",
    });
    expect(
      mapSseToChatEvent({ event: "aborted", data: { reason: "timeout" } }),
    ).toEqual({ type: "aborted", reason: "timeout" });
    expect(
      mapSseToChatEvent({ event: "aborted", data: { reason: "weird" } }),
    ).toEqual({ type: "aborted" });
  });

  it("maps error with a fallback message", () => {
    expect(
      mapSseToChatEvent({ event: "error", data: { message: "boom" } }),
    ).toEqual({ type: "error", message: "boom" });
    expect(mapSseToChatEvent({ event: "error", data: {} })).toEqual({
      type: "error",
      message: "unknown error",
    });
  });

  it("returns null for unknown events", () => {
    expect(mapSseToChatEvent({ event: "nope", data: {} })).toBeNull();
  });
});

describe("encode/decode round trip", () => {
  const events: ChatStreamEvent[] = [
    { type: "session_started", sessionId: "s1", protocolVersion: PROTOCOL_VERSION },
    { type: "assistant_text", text: "hello **world**" },
    {
      type: "tool_use",
      name: "Read",
      summary: "api.ts",
      details: [{ label: "File", value: "api.ts" }],
    },
    { type: "question", question: "Which nav?", options: ["Sidebar", "Top bar"] },
    {
      type: "controls",
      spec: {
        title: "Corners",
        controls: [
          {
            id: "radius",
            type: "slider",
            label: "Radius",
            min: 0,
            max: 32,
            step: 1,
            unit: "px",
            value: 8,
          },
        ],
      },
    },
    { type: "tool_use", name: "Mystery", details: [] },
    {
      type: "context_usage",
      contextTokens: 21591,
      contextWindow: 1_000_000,
      model: "claude-opus-4-8[1m]",
    },
    { type: "context_usage", contextTokens: 4004 },
    { type: "stderr", chunk: "some diagnostics\nwith newlines" },
    { type: "done", exitCode: 0 },
    { type: "aborted", reason: "timeout" },
    { type: "error", message: "boom" },
  ];

  it("survives encodeChatEvent → parseSseBuffer → mapSseToChatEvent for every variant", () => {
    for (const original of events) {
      const wire = encodeChatEvent(original);
      const { events: parsed, remainder } = parseSseBuffer(wire);
      expect(remainder).toBe("");
      expect(parsed).toHaveLength(1);
      expect(mapSseToChatEvent(parsed[0]!)).toEqual(original);
    }
  });

  it("formats SSE frames with event and data lines", () => {
    expect(formatSseEvent({ event: "done", data: { exitCode: 0 } })).toBe(
      'event: done\ndata: {"exitCode":0}\n\n',
    );
  });

  it("strips the type discriminant into the SSE event name", () => {
    expect(toSseEvent({ type: "assistant_text", text: "hi" })).toEqual({
      event: "assistant_text",
      data: { text: "hi" },
    });
  });

  it("sends the controls spec itself as the data payload", () => {
    const spec = {
      controls: [
        { id: "r", type: "slider" as const, label: "R", min: 0, max: 1, value: 0 },
      ],
    };
    expect(toSseEvent({ type: "controls", spec })).toEqual({
      event: "controls",
      data: spec,
    });
  });
});

describe("consumeSseResponse", () => {
  it("supports a custom mapEvent for app-extended validation", async () => {
    const wire =
      'event: assistant_text\ndata: {"text":"hi"}\n\n' +
      'event: controls\ndata: {"controls":[{"id":"r","type":"slider","label":"R","min":0,"max":1,"value":0}],"styles":[]}\n\n';
    const seen: string[] = [];
    await consumeSseResponse(
      new Response(wire, { status: 200 }),
      (ev) => seen.push(ev.type),
      {
        // An app validator that requires a non-empty styles extension —
        // the controls frame above fails it and is skipped.
        mapEvent: (ev) => {
          if (ev.event === "controls") return null;
          return mapSseToChatEvent(ev);
        },
      },
    );
    expect(seen).toEqual(["assistant_text"]);
  });
});

describe("isTerminalEvent", () => {
  it("treats done, aborted, and error as terminal", () => {
    expect(isTerminalEvent({ type: "done", exitCode: 0 })).toBe(true);
    expect(isTerminalEvent({ type: "aborted" })).toBe(true);
    expect(isTerminalEvent({ type: "error", message: "x" })).toBe(true);
    expect(isTerminalEvent({ type: "assistant_text", text: "x" })).toBe(false);
    expect(isTerminalEvent({ type: "stderr", chunk: "x" })).toBe(false);
  });
});
