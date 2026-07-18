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
export const PROTOCOL_VERSION = 1;

/** A small provider-normalized value shown inside an expanded tool-call row,
 * e.g. `{ label: "Command", value: "bun test" }`. */
export interface ToolCallDetail {
  label: string;
  value: string;
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
   * transcript, in stream order relative to assistant text. `summary` is a
   * one-line label; `details` are expandable label/value rows. Neither carries
   * tool output — this is a trace of what ran, not results.
   */
  | {
      type: "tool_use";
      name: string;
      summary?: string;
      details?: ToolCallDetail[];
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
   * seeded with its `value`, and on Apply send the message composed by
   * `composeApplyMessage(buildStyleMap(spec, values), spec.scope)` as the next
   * user turn. Non-DOM clients ignore `scope`/`styles` previews and keep the
   * widgets + Apply round-trip. A panel is retired by the next user message.
   */
  | { type: "controls"; spec: ControlsSpec }
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
