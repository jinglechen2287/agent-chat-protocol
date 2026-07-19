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

  it("projects WebFetch's extraction prompt alongside the URL", () => {
    expect(
      toolCallDetails({
        name: "WebFetch",
        input: { url: "https://x.test", prompt: "Summarize the changelog" },
      }),
    ).toEqual([
      { label: "URL", value: "https://x.test" },
      { label: "Prompt", value: "Summarize the changelog" },
    ]);
  });

  it("projects Bash's human description alongside the command", () => {
    expect(
      toolCallDetails({
        name: "Bash",
        input: { command: "bun test", description: "Run the test suite" },
      }),
    ).toEqual([
      { label: "Command", value: "bun test" },
      { label: "Description", value: "Run the test suite" },
    ]);
  });

  it("projects the launched subagent type for Task and Agent", () => {
    for (const name of ["Task", "Agent"]) {
      expect(
        toolCallDetails({
          name,
          input: { description: "Map the plumbing", subagent_type: "Explore" },
        }),
      ).toEqual([
        { label: "Task", value: "Map the plumbing" },
        { label: "Agent", value: "Explore" },
      ]);
    }
  });

  it("projects task creation metadata", () => {
    expect(
      toolCallDetails({
        name: "TaskCreate",
        input: {
          taskId: "7",
          subject: "Ship task indicators",
          description: "Show the task subject and status in the transcript.",
          activeForm: "Shipping task indicators",
        },
      }),
    ).toEqual([
      { label: "Task", value: "Ship task indicators" },
      { label: "Task ID", value: "7" },
      {
        label: "Description",
        value: "Show the task subject and status in the transcript.",
      },
      { label: "Active form", value: "Shipping task indicators" },
    ]);
  });

  it("projects task update metadata", () => {
    expect(
      toolCallDetails({
        name: "TaskUpdate",
        input: {
          taskId: "7",
          subject: "Ship task indicators",
          status: "in_progress",
        },
      }),
    ).toEqual([
      { label: "Task", value: "Ship task indicators" },
      { label: "Task ID", value: "7" },
      { label: "Status", value: "In progress" },
    ]);
  });

  it("projects every Codex plan item with a readable status", () => {
    expect(
      toolCallDetails({
        name: "TodoWrite",
        summary: "1/3 steps completed",
        planItems: [
          { text: "Inspect repository", status: "completed" },
          { text: "Implement support", status: "in_progress" },
          { text: "Verify tests", status: "pending" },
        ],
      }),
    ).toEqual([
      { label: "Completed", value: "Inspect repository" },
      { label: "In progress", value: "Implement support" },
      { label: "Pending", value: "Verify tests" },
    ]);
  });

  it("projects Skill to the skill name and its arguments", () => {
    expect(
      toolCallDetails({
        name: "Skill",
        input: { skill: "code-review", args: "--base main" },
      }),
    ).toEqual([
      { label: "Skill", value: "code-review" },
      { label: "Arguments", value: "--base main" },
    ]);
  });

  it("projects Skill with just the skill name when there are no arguments", () => {
    expect(
      toolCallDetails({ name: "Skill", input: { skill: "linear" } }),
    ).toEqual([{ label: "Skill", value: "linear" }]);
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
