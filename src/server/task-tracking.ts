/**
 * Claude's task tools, matched across calls. A TaskCreate's task id only
 * appears in its result ("Task #3 created successfully"), so the create is
 * held until that result lands and then released with the id filled in. A
 * TaskUpdate usually names the task by id alone, so the subject an earlier
 * call carried is filled back in. Clients then see one task, not two strangers.
 */

import type { ToolResultInfo, ToolUseInfo } from "agent-cli-runner";
import type { ToolTaskMetadata } from "../events";
import { isRecord } from "../guards";
import { toolTaskMetadata } from "./tool-details";

export interface TaskCallTracker {
  /** Emits the call now, or holds a TaskCreate until its result. A
   * subject-less TaskUpdate gets the subject its task was last seen with. */
  toolUse(info: ToolUseInfo): void;
  /** Releases the TaskCreate this result answers, with its task id. */
  toolResult(result: ToolResultInfo): void;
  /** Releases every held TaskCreate as it is: the turn is ending. */
  flush(): void;
}

/** A tool result's text, whether the provider sent a string or text blocks. */
function resultText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content.flatMap((block) =>
    isRecord(block) && typeof block.text === "string" ? [block.text] : []);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function taskIdFromResult(result: ToolResultInfo): string | undefined {
  if (result.isError) return undefined;
  return resultText(result.content)?.match(/Task #([^\s:]+) created successfully/)?.[1];
}

export function createTaskCallTracker(
  emit: (info: ToolUseInfo, task: ToolTaskMetadata | undefined) => void,
): TaskCallTracker {
  const pendingCreates = new Map<string, ToolUseInfo>();
  const subjects = new Map<string, string>();

  const release = (info: ToolUseInfo): void => {
    const task = toolTaskMetadata(info);
    if (task?.id && task.subject) subjects.set(task.id, task.subject);
    emit(info, task);
  };

  const withKnownSubject = (info: ToolUseInfo): ToolUseInfo => {
    if (info.name !== "TaskUpdate" || !info.input) return info;
    // An update carrying its own subject is a rename: let it through, and
    // release() caches the new subject.
    if (typeof info.input.subject === "string" && info.input.subject.trim()) return info;
    const taskId = typeof info.input.taskId === "string" ? info.input.taskId.trim() : "";
    const subject = subjects.get(taskId);
    return subject ? { ...info, input: { ...info.input, subject } } : info;
  };

  return {
    toolUse(info) {
      if (info.name === "TaskCreate" && info.callId) {
        pendingCreates.set(info.callId, info);
        return;
      }
      release(withKnownSubject(info));
    },
    toolResult(result) {
      const pending = pendingCreates.get(result.callId);
      if (!pending) return;
      pendingCreates.delete(result.callId);
      const taskId = taskIdFromResult(result);
      release(taskId ? { ...pending, input: { ...pending.input, taskId } } : pending);
    },
    flush() {
      for (const pending of pendingCreates.values()) release(pending);
      pendingCreates.clear();
    },
  };
}
