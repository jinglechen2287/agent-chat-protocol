import { describe, expect, it } from "vitest";
import { toolCallDetails } from "../src/server/index";

describe("toolCallDetails", () => {
  it("projects Bash to its command", () => {
    expect(
      toolCallDetails({ name: "Bash", input: { command: "bun test" } }),
    ).toEqual([{ label: "Command", value: "bun test" }]);
  });

  it("projects file tools to their file path", () => {
    for (const name of ["Read", "Edit", "MultiEdit", "Write"]) {
      expect(
        toolCallDetails({ name, input: { file_path: "/x/api.ts" } }),
      ).toEqual([{ label: "File", value: "/x/api.ts" }]);
    }
  });

  it("projects Grep to pattern and path", () => {
    expect(
      toolCallDetails({ name: "Grep", input: { pattern: "foo", path: "src" } }),
    ).toEqual([
      { label: "Pattern", value: "foo" },
      { label: "Path", value: "src" },
    ]);
  });

  it("projects WebFetch and WebSearch", () => {
    expect(
      toolCallDetails({ name: "WebFetch", input: { url: "https://x.test" } }),
    ).toEqual([{ label: "URL", value: "https://x.test" }]);
    expect(
      toolCallDetails({ name: "WebSearch", input: { query: "how" } }),
    ).toEqual([{ label: "Query", value: "how" }]);
  });

  it("expands Codex file_change batches on Edit", () => {
    expect(
      toolCallDetails({
        name: "Edit",
        input: {
          type: "file_change",
          changes: [
            { kind: "update", path: "a.ts" },
            { kind: "add", path: "b.ts" },
            { kind: "delete", path: "c.ts" },
          ],
        },
      }),
    ).toEqual([
      { label: "Modified file", value: "a.ts" },
      { label: "Added file", value: "b.ts" },
      { label: "Deleted file", value: "c.ts" },
    ]);
  });

  it("falls back to the summary with a tool-appropriate label", () => {
    expect(toolCallDetails({ name: "Bash", summary: "ls -la" })).toEqual([
      { label: "Command", value: "ls -la" },
    ]);
    expect(toolCallDetails({ name: "SomethingNew", summary: "did stuff" })).toEqual([
      { label: "Details", value: "did stuff" },
    ]);
  });

  it("returns no details when there is nothing meaningful", () => {
    expect(toolCallDetails({ name: "Bash" })).toEqual([]);
    expect(toolCallDetails({ name: "Bash", input: { command: "  " } })).toEqual([]);
  });
});
