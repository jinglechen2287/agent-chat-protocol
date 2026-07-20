/**
 * The canonical event vocabulary for one streamed agent turn — the wire
 * contract between a chat server and any client rendering it.
 *
 * The TSDoc on each variant is normative: it states what a conforming client
 * MUST render and how the user's interaction feeds back into the next turn.
 * See the README for the full rendering contract.
 */

import type { QuestionSpec } from "./question";
import type { ControlsSpec } from "./controls";

/**
 * Version of this event contract. Servers include it on `session_started` so
 * clients replaying buffered events across a deploy can detect skew.
 */
export const PROTOCOL_VERSION = 3;

/** A small provider-normalized value shown inside an expanded tool-call row,
 * e.g. `{ label: "Command", value: "bun test" }`. */
export interface ToolCallDetail {
  label: string;
  value: string;
}

/** Provider-normalized task identity carried by task-management tool calls.
 * It lets clients correlate a later TaskUpdate with its earlier TaskCreate. */
export interface ToolTaskMetadata {
  id?: string;
  subject?: string;
  status?: string;
}

/** One provider-normalized step from a Codex plan/todo snapshot. */
export interface ToolPlanItem {
  text: string;
  status: string;
}

export type BackgroundAgentStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "interrupted";

export interface BackgroundAgentProgress {
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
  lastToolName?: string;
}

/** A complete, replace-in-place snapshot of one provider background agent. */
export interface BackgroundAgent {
  id: string;
  provider: "claude" | "codex";
  parentToolCallId?: string;
  description?: string;
  agentType?: string;
  status: BackgroundAgentStatus;
  summary?: string;
  error?: string;
  progress?: BackgroundAgentProgress;
  /** Unix epoch timestamp in milliseconds, captured by the runner clock. */
  startedAt: number;
  /** Unix epoch timestamp in milliseconds for this snapshot. */
  updatedAt: number;
  /** Unix epoch timestamp in milliseconds when the agent reached a terminal state. */
  endedAt?: number;
}

/** Why a turn ended without completing. `user` is a deliberate cancel;
 * `timeout` is the runner's wall-clock limit. Render them differently. */
export type AbortReason = "user" | "timeout";

export type ChatStreamEvent =
  /**
   * The turn is running under this session/thread id. Emitted once near the
   * start of a first turn. Clients persist the id and send it back on the next
   * turn to continue the conversation; a second occurrence with a different id
   * supersedes the first. Not emitted on resumed turns — the client already
   * holds the id it resumed with.
   */
  | {
      type: "session_started";
      sessionId: string;
      /** Contract version the server speaks; see {@link PROTOCOL_VERSION}. */
      protocolVersion?: number;
    }
  /**
   * A completed assistant message. Clients MUST render it as GitHub-flavored
   * markdown (sanitized). Multiple occurrences in one turn are separate
   * messages, in order — not fragments to concatenate.
   */
  | { type: "assistant_text"; text: string }
  /**
   * The agent invoked a tool. Clients MUST show at least `name` inline in the
   * transcript and preserve every event in stream order relative to assistant
   * text. `summary` is an optional concise description; `details` are optional
   * curated label/value metadata. Neither carries tool output — this is a trace
   * of what ran, not results. Grouping and expansion layout are non-normative
   * client presentation choices; see the README guidance.
   */
  | {
      type: "tool_use";
      name: string;
      summary?: string;
      details?: ToolCallDetail[];
      task?: ToolTaskMetadata;
      plan?: ToolPlanItem[];
    }
  /**
   * A structured clarifying question. Clients MUST render the options as
   * selectable choices; the chosen option's label (or a typed free-text reply)
   * is sent verbatim as the next user turn. Selecting locally marks the card
   * answered — no special reply channel exists.
   */
  | { type: "question"; question: string; options: QuestionSpec["options"] }
  /**
   * A live parameter panel. Clients MUST render each control as an input
   * seeded with its `value`, and on Apply send an app-defined message
   * composed from the final values as the next user turn. Apps may extend
   * the spec with extra fields via their own validators (carve layers CSS
   * style bindings this way); a client that doesn't understand an extension
   * renders the widgets + Apply round-trip and ignores the rest. A panel is
   * retired by the next user message.
   */
  | { type: "controls"; spec: ControlsSpec }
  /**
   * A context-window usage snapshot for the turn. Non-terminal and may arrive
   * more than once (each supersedes the last); clients render the latest as a
   * context meter. `contextWindow` is absent when the provider reported no
   * window and none could be resolved — show `contextTokens` without a
   * percentage in that case. Counts are provider-reported and may be
   * approximate; clamp the meter at 100% rather than treating overflow as an
   * error.
   */
  | {
      type: "context_usage";
      /** Tokens occupying the context window, per the provider's best report. */
      contextTokens: number;
      /** Total window size in tokens, when known. */
      contextWindow?: number;
      /** Model that produced the usage, when known. */
      model?: string;
    }
  /**
   * The canonical title for the chat containing this turn. Non-terminal and
   * emitted when an asynchronous title generator replaces the app's immediate
   * fallback. Clients MUST update the chat/thread title without adding a
   * transcript message.
   */
  | { type: "thread_title"; title: string }
  /**
   * A full background-agent lifecycle snapshot. Non-terminal and mutable:
   * clients MUST upsert by `agent.id`, replacing the prior snapshot instead
   * of appending a transcript message for every progress event. Status is one
   * of `pending`, `running`, `completed`, `failed`, or `interrupted`; provider
   * ids, spawn correlation, progress, summaries, errors, and Unix-millisecond
   * timestamps remain available on the snapshot.
   */
  | { type: "background_agent_updated"; agent: BackgroundAgent }
  /**
   * Raw stderr from the agent CLI. Diagnostic channel — clients MAY ignore it
   * or surface it in a collapsed log. Never render it as assistant prose.
   */
  | { type: "stderr"; chunk: string }
  /** Terminal: the turn completed. `exitCode` 0 is success. */
  | { type: "done"; exitCode: number }
  /** Terminal: the turn was killed before completing. See {@link AbortReason};
   * absent means an unspecified abort (treat as `user`). */
  | { type: "aborted"; reason?: AbortReason }
  /** Terminal: the turn failed. `message` is human-readable and safe to show. */
  | { type: "error"; message: string };

/** True for the three events that end a turn's stream: `done`, `aborted`,
 * `error`. After one of these, no further events arrive for the turn. */
export function isTerminalEvent(ev: ChatStreamEvent): boolean {
  return ev.type === "done" || ev.type === "aborted" || ev.type === "error";
}
