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
  McpElicitationResponse,
  McpServerStatusInfo,
  TokenUsage,
  ToolUseInfo,
} from "agent-cli-runner";
import { PROTOCOL_VERSION, type ChatStreamEvent, type ToolTaskMetadata } from "../events";
import { parseQuestionBlock } from "../question";
import { parseProposedPlan } from "../plan";
import {
  parseControlsBlock,
  validateControls,
  type ControlsSpec,
} from "../controls";
import { parseJsonLine, parseViewBlock, validateViewComponent } from "../view";
import { parseHtmlBlock } from "../html";
import { definedProps } from "../guards";
import { toolCallDetails } from "./tool-details";
import { createTaskCallTracker } from "./task-tracking";
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

/**
 * The events one completed assistant message becomes. The agent may end a
 * message with structured plan, question, controls, view, or html blocks.
 * Controls are a complete UI response, so when one is valid all surrounding
 * prose is suppressed and only the panel is emitted. Views and html pages are
 * content like prose: their surrounding text stays. The plan block is lifted
 * first: its body is markdown that may contain any of the fenced blocks, and
 * those belong to the plan, not the turn.
 */
function assistantMessageEvents(
  text: string,
  controlsValidator: (value: unknown) => ControlsSpec | null,
): ChatStreamEvent[] {
  const parsedPlan = parseProposedPlan(text);
  const parsedQuestion = parseQuestionBlock(parsedPlan.text);
  const parsedControls = parseControlsBlock(parsedQuestion.text, controlsValidator);
  const parsedView = parseViewBlock(parsedControls.text);
  const parsedHtml = parseHtmlBlock(parsedView.text);
  const events: ChatStreamEvent[] = [];
  if (!parsedControls.controls && parsedHtml.text) {
    events.push({ type: "assistant_text", text: parsedHtml.text });
  }
  if (parsedPlan.plan) events.push({ type: "plan", ...parsedPlan.plan });
  if (parsedView.view) events.push({ type: "view", spec: parsedView.view });
  if (parsedHtml.html) events.push({ type: "html", content: parsedHtml.html });
  if (parsedQuestion.question) events.push({ type: "question", ...parsedQuestion.question });
  if (parsedControls.controls) events.push({ type: "controls", spec: parsedControls.controls });
  return events;
}

export function createChatEventBridge(
  emit: (ev: ChatStreamEvent) => void,
  options: ChatEventBridgeOptions = {},
): ChatEventBridge {
  let announcedSessionId = options.knownSessionId;
  let terminal = false;

  /** Drops calls once the turn has ended: late runner callbacks must not
   * follow the terminal event. */
  const live = <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A): void => {
      if (!terminal) fn(...args);
    };

  const announceSession = (sessionId: string): void => {
    if (sessionId === announcedSessionId) return;
    announcedSessionId = sessionId;
    emit({
      type: "session_started",
      sessionId,
      protocolVersion: PROTOCOL_VERSION,
    });
  };

  // The contract promises exactly one terminal event per turn: enforce it
  // here so a finish/fail race (or a double call) can't corrupt the stream.
  const emitTerminal = (ev: ChatStreamEvent): void => {
    if (terminal) return;
    terminal = true;
    emit(ev);
  };

  if (options.presetSessionId) announceSession(options.presetSessionId);

  const controlsValidator = options.controlsValidator ?? validateControls;

  // Fragments carry the index of the message they will become, so a client can
  // keep per-message scratch buffers and discard each one when its completed
  // `assistant_text` lands.
  const textStream = createTextDeltaStream();
  let messageIndex = 0;

  const onAssistantTextDelta = (chunk: string): void => {
    const { text, viewLines, htmlLines } = textStream.push(chunk);
    if (text) emit({ type: "assistant_text_delta", index: messageIndex, delta: text });
    if (htmlLines.length > 0) {
      emit({ type: "html_delta", index: messageIndex, delta: htmlLines.join("") });
    }
    for (const line of viewLines) {
      // Per-line validation only: graph rules run on the completed view,
      // which supersedes these fragments. A bad line is dropped, matching
      // parseViewBlock's skip-and-survive behavior.
      const parsed = parseJsonLine(line);
      const component = parsed.ok ? validateViewComponent(parsed.value) : null;
      if (component) emit({ type: "view_line", index: messageIndex, component });
    }
  };

  const onAssistantText = (text: string): void => {
    for (const ev of assistantMessageEvents(text, controlsValidator)) emit(ev);
    // This message is now transcript content; fragments start over for the
    // next one, whether or not this one produced an `assistant_text`.
    textStream.reset();
    messageIndex += 1;
  };

  const tasks = createTaskCallTracker((info: ToolUseInfo, task: ToolTaskMetadata | undefined) => {
    const details = toolCallDetails(info);
    emit({
      type: "tool_use",
      name: info.name,
      ...definedProps({
        summary: info.summary,
        details: details.length > 0 ? details : undefined,
        task,
        plan: info.planItems && info.planItems.length > 0 ? info.planItems : undefined,
      }),
    });
  });

  const onUsage = (usage: TokenUsage): void => {
    emit({
      type: "context_usage",
      contextTokens: usage.contextTokens,
      ...definedProps({ contextWindow: usage.contextWindow, model: usage.model }),
    });
  };

  // Answering needs a client and a way back, which only the host has: it
  // overrides this. Until then, the behaviour the CLIs have with no handler.
  const onMcpElicitation = async (): Promise<McpElicitationResponse> => ({ action: "decline" });

  return {
    callbacks: {
      onSessionId: live(announceSession),
      onAssistantText: live(onAssistantText),
      onAssistantTextDelta: live(onAssistantTextDelta),
      onToolUse: live(tasks.toolUse),
      onToolResult: live(tasks.toolResult),
      onBackgroundAgentUpdate: live((agent: BackgroundAgentInfo) => {
        emit({ type: "background_agent_updated", agent });
      }),
      onStderr: live((chunk: string) => emit({ type: "stderr", chunk })),
      onUsage: live(onUsage),
      onMcpStatus: live((servers: McpServerStatusInfo[]) => emit({ type: "mcp_status", servers })),
      onMcpElicitation,
    },
    finish(result: { exitCode: number }): void {
      tasks.flush();
      emitTerminal({ type: "done", exitCode: result.exitCode });
    },
    fail(err: unknown): void {
      tasks.flush();
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
