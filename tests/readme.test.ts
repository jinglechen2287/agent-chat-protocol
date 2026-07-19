import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
