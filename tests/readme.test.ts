import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../src/index";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("tool-call documentation", () => {
  it("separates protocol requirements from client presentation guidance", () => {
    expect(readme).toContain("### Recommended tool-call presentation (non-normative)");
    expect(readme).toContain("MUST preserve every event and its stream order");
    expect(readme).toContain("MAY visually group consecutive `tool_use` events");
    expect(readme).toContain("does not imply semantic batching or parallel execution");
    expect(readme).toContain("remain Layer 3 application concerns");
  });
});

describe("event documentation", () => {
  it("lists every stream event in the client contract, including metadata events", () => {
    expect(readme).toContain("**`context_usage`**");
    expect(readme).toContain("**`thread_title`**");
    expect(readme).toContain("createChatTitleGenerator");
  });

  it("documents the protocol version the code exports", () => {
    expect(readme).toContain(`PROTOCOL_VERSION = ${PROTOCOL_VERSION}`);
  });
});

describe("view documentation", () => {
  it("documents the view rendering contract and its degradation rule", () => {
    expect(readme).toContain("**`view`**");
    expect(readme).toContain("skip unknown or invalid ones");
    expect(readme).toContain("no executable payloads");
    expect(readme).toContain("VIEW_PROMPT");
  });
});

describe("streamed view documentation", () => {
  it("states that view lines are scratch the completed view supersedes", () => {
    expect(readme).toContain("**`view_line`**");
    expect(readme).toContain("full graph validation, which per-line delivery cannot");
    expect(readme).toContain("pendingViewLines");
  });
});

describe("streamed text documentation", () => {
  it("states that fragments are scratch state, not transcript messages", () => {
    expect(readme).toContain("**`assistant_text_delta`**");
    expect(readme).toContain("MUST NOT be persisted or counted as a replayed message");
    expect(readme).toContain("stop at a generative-UI block");
  });

  it("explains why fragments stay out of the replay buffer", () => {
    expect(readme).toContain("is the one event kept **out** of that buffer");
    expect(readme).toContain("pushPartial");
  });
});
