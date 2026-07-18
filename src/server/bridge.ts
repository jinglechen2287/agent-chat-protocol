/**
 * The runner→events bridge: adapts agent-cli-runner's four callbacks into the
 * typed {@link ChatStreamEvent} stream, applying the emit-side grammar
 * (question/controls block extraction) on the way through.
 *
 * Usage:
 *
 *   const bridge = createChatEventBridge((ev) => store.push(task, ev), {
 *     presetSessionId: newSessionId,   // first turn only, when pre-minted
 *   });
 *   try {
 *     const result = await runClaude({ ...options, ...bridge.callbacks });
 *     bridge.finish(result);
 *   } catch (err) {
 *     bridge.fail(err);
 *   }
 */

import type { AgentCallbacks, ToolUseInfo } from "agent-cli-runner";
import type { ChatStreamEvent } from "../events";
import { parseQuestionBlock } from "../question";
import { parseControlsBlock } from "../controls";
import { toolCallDetails } from "./tool-details";

export interface ChatEventBridgeOptions {
  /**
   * A session id the caller minted before spawning (so the client learns it
   * even if the CLI dies before reporting one). The bridge announces it
   * immediately; if the runner later reports a different id, that one is
   * announced too and supersedes it.
   */
  presetSessionId?: string;
}

export interface ChatEventBridge {
  /** Wire these into the runner's run options (all four callbacks). */
  callbacks: Required<AgentCallbacks>;
  /** Call with the runner's result to emit the terminal `done` event. */
  finish(result: { exitCode: number }): void;
  /** Call with the runner's rejection to emit the terminal event: AbortError
   * → `aborted` (user), TimeoutError → `aborted` (timeout), else `error`. */
  fail(err: unknown): void;
}

export function createChatEventBridge(
  emit: (ev: ChatStreamEvent) => void,
  options: ChatEventBridgeOptions = {},
): ChatEventBridge {
  let announcedSessionId: string | undefined;

  const announceSession = (sessionId: string): void => {
    if (sessionId === announcedSessionId) return;
    announcedSessionId = sessionId;
    emit({ type: "session_started", sessionId });
  };

  if (options.presetSessionId) announceSession(options.presetSessionId);

  const onSessionId = (id: string): void => {
    announceSession(id);
  };

  const onAssistantText = (text: string): void => {
    // The agent may end a message with a structured question or controls
    // block. Controls are a complete UI response, so when one is valid
    // suppress all surrounding prose and emit only the panel.
    const parsedQuestion = parseQuestionBlock(text);
    const parsedControls = parseControlsBlock(parsedQuestion.text);
    if (!parsedControls.controls && parsedControls.text) {
      emit({ type: "assistant_text", text: parsedControls.text });
    }
    if (parsedQuestion.question) {
      emit({ type: "question", ...parsedQuestion.question });
    }
    if (parsedControls.controls) {
      emit({ type: "controls", spec: parsedControls.controls });
    }
  };

  const onToolUse = (info: ToolUseInfo): void => {
    const details = toolCallDetails(info);
    emit({
      type: "tool_use",
      name: info.name,
      ...(info.summary !== undefined ? { summary: info.summary } : {}),
      ...(details.length > 0 ? { details } : {}),
    });
  };

  const onStderr = (chunk: string): void => {
    emit({ type: "stderr", chunk });
  };

  return {
    callbacks: { onSessionId, onAssistantText, onToolUse, onStderr },
    finish(result: { exitCode: number }): void {
      emit({ type: "done", exitCode: result.exitCode });
    },
    fail(err: unknown): void {
      const name = (err as { name?: string } | null)?.name;
      if (name === "AbortError") {
        emit({ type: "aborted", reason: "user" });
      } else if (name === "TimeoutError") {
        emit({ type: "aborted", reason: "timeout" });
      } else {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
