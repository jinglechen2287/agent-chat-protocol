/**
 * Projects a runner-reported tool invocation down to the small label/value
 * pairs a transcript should retain — the payload of a `tool_use` event's
 * `details`. Intentionally excludes edit bodies, command output, and other
 * potentially large payloads.
 */

import type { ToolUseInfo } from "agent-cli-runner";
import type { ToolCallDetail } from "../events";

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function detail(label: string, value: unknown): ToolCallDetail | undefined {
  const normalized = text(value);
  return normalized ? { label, value: normalized } : undefined;
}

function fallbackLabel(name: string): string {
  switch (name) {
    case "Bash":
      return "Command";
    case "Read":
    case "Edit":
    case "MultiEdit":
    case "Write":
      return "File";
    case "NotebookEdit":
      return "Notebook";
    case "Grep":
    case "Glob":
      return "Pattern";
    case "WebFetch":
      return "URL";
    case "WebSearch":
      return "Query";
    case "Task":
    case "Agent":
      return "Task";
    default:
      return "Details";
  }
}

function fileChangeLabel(kind: unknown): string {
  switch (kind) {
    case "update":
    case "modify":
    case "modified":
      return "Modified file";
    case "add":
    case "create":
    case "added":
      return "Added file";
    case "delete":
    case "deleted":
      return "Deleted file";
    default:
      return "File";
  }
}

function codexFileChanges(input: Record<string, unknown>): ToolCallDetail[] {
  if (input.type !== "file_change" || !Array.isArray(input.changes)) return [];
  const details: ToolCallDetail[] = [];
  for (const change of input.changes) {
    if (!change || typeof change !== "object" || Array.isArray(change)) continue;
    const record = change as Record<string, unknown>;
    const file = detail(fileChangeLabel(record.kind), record.path);
    if (file) details.push(file);
  }
  return details;
}

/**
 * Reduce provider-specific raw tool input to the useful values the transcript
 * should retain.
 */
export function toolCallDetails(info: ToolUseInfo): ToolCallDetail[] {
  const input = info.input;
  const details: ToolCallDetail[] = [];

  if (input) {
    if (info.name === "Edit") details.push(...codexFileChanges(input));

    const add = (label: string, value: unknown): void => {
      const next = detail(label, value);
      if (next) details.push(next);
    };

    switch (info.name) {
      case "Bash":
        add("Command", input.command);
        break;
      case "Read":
      case "Edit":
      case "MultiEdit":
      case "Write":
        add("File", input.file_path);
        break;
      case "NotebookEdit":
        add("Notebook", input.notebook_path ?? input.file_path);
        break;
      case "Grep":
      case "Glob":
        add("Pattern", input.pattern);
        add("Path", input.path);
        break;
      case "WebFetch":
        add("URL", input.url);
        break;
      case "WebSearch":
        add("Query", input.query);
        break;
      case "Task":
      case "Agent":
        add("Task", input.description);
        break;
    }
  }

  if (details.length === 0) {
    const fallback = detail(fallbackLabel(info.name), info.summary);
    if (fallback) details.push(fallback);
  }
  return details;
}
