/**
 * The runner→events bridge: adapts agent-cli-runner callbacks into the
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

import type {
  AgentCallbacks,
  BackgroundAgentInfo,
  TokenUsage,
  ToolResultInfo,
  ToolUseInfo,
} from "agent-cli-runner";
import { PROTOCOL_VERSION, type ChatStreamEvent } from "../events";
import { parseQuestionBlock } from "../question";
import {
  parseControlsBlock,
  validateControls,
  type ControlsSpec,
} from "../controls";
import { parseViewBlock, validateViewComponent } from "../view";
import { parseHtmlBlock } from "../html";
import { toolCallDetails, toolTaskMetadata } from "./tool-details";
import { createTextDeltaStream } from "./text-stream";

export interface ChatEventBridgeOptions {
  /**
   * A session id the caller minted before spawning (so the client learns it
   * even if the CLI dies before reporting one). The bridge announces it
   * immediately; if the runner later reports a different id, that one is
   * announced too and supersedes it.
   */
  presetSessionId?: string;
  /**
   * The session id of a resumed turn — the client already holds it, so the
   * contract says `session_started` is not re-emitted. The bridge treats it
   * as already announced; a *different* runner-reported id is still announced
   * (the client must learn a changed id or its next resume would fail).
   */
  knownSessionId?: string;
  /**
   * Overrides controls-block validation (default: the core widgets-only
   * validator). Apps that extend the spec (e.g. carve's CSS style bindings)
   * pass their validator; when it rejects a block, the block stays in the
   * assistant text as prose, exactly like a malformed block.
   */
  controlsValidator?: (value: unknown) => ControlsSpec | null;
}

export interface ChatEventBridge {
  /** Wire these into the runner's run options. */
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
  let announcedSessionId = options.knownSessionId;
  let terminal = false;
  const pendingTaskCreates = new Map<string, ToolUseInfo>();
  const taskSubjects = new Map<string, string>();

  const announceSession = (sessionId: string): void => {
    if (sessionId === announcedSessionId) return;
    announcedSessionId = sessionId;
    emit({
      type: "session_started",
      sessionId,
      protocolVersion: PROTOCOL_VERSION,
    });
  };

  // The contract promises exactly one terminal event per turn — enforce it
  // here so a finish/fail race (or a double call) can't corrupt the stream.
  const emitTerminal = (ev: ChatStreamEvent): void => {
    if (terminal) return;
    terminal = true;
    emit(ev);
  };

  if (options.presetSessionId) announceSession(options.presetSessionId);

  const onSessionId = (id: string): void => {
    announceSession(id);
  };

  const controlsValidator = options.controlsValidator ?? validateControls;

  // Fragments carry the index of the message they will become, so a client can
  // keep per-message scratch buffers and discard each one when its completed
  // `assistant_text` lands.
  const textStream = createTextDeltaStream();
  let messageIndex = 0;

  const onAssistantTextDelta = (chunk: string): void => {
    if (terminal) return;
    const { text, viewLines, htmlLines } = textStream.push(chunk);
    if (text) emit({ type: "assistant_text_delta", index: messageIndex, delta: text });
    if (htmlLines.length > 0) {
      emit({ type: "html_delta", index: messageIndex, delta: htmlLines.join("") });
    }
    for (const line of viewLines) {
      // Per-line validation only — graph rules run on the completed view,
      // which supersedes these fragments. A bad line is dropped, matching
      // parseViewBlock's skip-and-survive behavior.
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const component = validateViewComponent(parsed);
      if (component) emit({ type: "view_line", index: messageIndex, component });
    }
  };

  const onAssistantText = (text: string): void => {
    // The agent may end a message with structured question, controls, view,
    // or html blocks. Controls are a complete UI response, so when one is
    // valid suppress all surrounding prose and emit only the panel. Views
    // and html pages are content like prose — their surrounding text stays.
    const parsedQuestion = parseQuestionBlock(text);
    const parsedControls = parseControlsBlock(parsedQuestion.text, controlsValidator);
    const parsedView = parseViewBlock(parsedControls.text);
    const parsedHtml = parseHtmlBlock(parsedView.text);
    if (!parsedControls.controls && parsedHtml.text) {
      emit({ type: "assistant_text", text: parsedHtml.text });
    }
    if (parsedView.view) {
      emit({ type: "view", spec: parsedView.view });
    }
    if (parsedHtml.html) {
      emit({ type: "html", content: parsedHtml.html });
    }
    if (parsedQuestion.question) {
      emit({ type: "question", ...parsedQuestion.question });
    }
    if (parsedControls.controls) {
      emit({ type: "controls", spec: parsedControls.controls });
    }
    // This message is now transcript content; fragments start over for the
    // next one, whether or not this one produced an `assistant_text`.
    textStream.reset();
    messageIndex += 1;
  };

  const emitToolUse = (info: ToolUseInfo): void => {
    const details = toolCallDetails(info);
    const task = toolTaskMetadata(info);
    if (task?.id && task.subject) taskSubjects.set(task.id, task.subject);
    emit({
      type: "tool_use",
      name: info.name,
      ...(info.summary !== undefined ? { summary: info.summary } : {}),
      ...(details.length > 0 ? { details } : {}),
      ...(task ? { task } : {}),
      ...(info.planItems && info.planItems.length > 0 ? { plan: info.planItems } : {}),
    });
  };

  const withKnownTaskSubject = (info: ToolUseInfo): ToolUseInfo => {
    if (info.name !== "TaskUpdate" || !info.input) return info;
    const taskId = typeof info.input.taskId === "string" ? info.input.taskId.trim() : "";
    const subject = taskSubjects.get(taskId);
    return subject
      ? { ...info, input: { ...info.input, subject } }
      : info;
  };

  const onToolUse = (info: ToolUseInfo): void => {
    if (info.name === "TaskCreate" && info.callId) {
      pendingTaskCreates.set(info.callId, info);
      return;
    }
    emitToolUse(withKnownTaskSubject(info));
  };

  const resultText = (content: unknown): string | undefined => {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return undefined;
    const parts = content.flatMap((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block)) return [];
      const value = (block as Record<string, unknown>).text;
      return typeof value === "string" ? [value] : [];
    });
    return parts.length > 0 ? parts.join("\n") : undefined;
  };

  const taskIdFromResult = (result: ToolResultInfo): string | undefined => {
    if (result.isError) return undefined;
    return resultText(result.content)?.match(/Task #([^\s:]+) created successfully/)?.[1];
  };

  const onToolResult = (result: ToolResultInfo): void => {
    const pending = pendingTaskCreates.get(result.callId);
    if (!pending) return;
    pendingTaskCreates.delete(result.callId);
    const taskId = taskIdFromResult(result);
    emitToolUse(taskId
      ? { ...pending, input: { ...pending.input, taskId } }
      : pending);
  };

  const flushPendingTaskCreates = (): void => {
    for (const pending of pendingTaskCreates.values()) emitToolUse(pending);
    pendingTaskCreates.clear();
  };

  const onStderr = (chunk: string): void => {
    emit({ type: "stderr", chunk });
  };

  const onUsage = (usage: TokenUsage): void => {
    emit({
      type: "context_usage",
      contextTokens: usage.contextTokens,
      ...(usage.contextWindow !== undefined ? { contextWindow: usage.contextWindow } : {}),
      ...(usage.model !== undefined ? { model: usage.model } : {}),
    });
  };

  const onBackgroundAgentUpdate = (agent: BackgroundAgentInfo): void => {
    emit({ type: "background_agent_updated", agent });
  };

  return {
    callbacks: {
      onSessionId,
      onAssistantText,
      onAssistantTextDelta,
      onToolUse,
      onToolResult,
      onBackgroundAgentUpdate,
      onStderr,
      onUsage,
    },
    finish(result: { exitCode: number }): void {
      flushPendingTaskCreates();
      emitTerminal({ type: "done", exitCode: result.exitCode });
    },
    fail(err: unknown): void {
      flushPendingTaskCreates();
      const name = (err as { name?: string } | null)?.name;
      if (name === "AbortError") {
        emitTerminal({ type: "aborted", reason: "user" });
      } else if (name === "TimeoutError") {
        emitTerminal({ type: "aborted", reason: "timeout" });
      } else {
        emitTerminal({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
