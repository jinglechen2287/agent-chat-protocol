//#region src/question.d.ts
/**
 * The structured clarifying-question block an agent can end a message with:
 *
 *   ```agent-question
 *   {"question": "Which nav style?", "options": ["Sidebar", "Top bar"]}
 *   ```
 *
 * When present and well-formed the block is lifted into a `QuestionSpec` and
 * stripped from the surrounding prose. A malformed block is left untouched as
 * plain text — showing the user a slightly raw message beats dropping it.
 *
 * The legacy `carve-question` fence is accepted during migration.
 */
interface QuestionSpec {
  /** The clarifying question to put to the user. */
  question: string;
  /** Two or more short answer labels the user can pick from. */
  options: string[];
}
interface ParsedQuestionText {
  /** The message text with a valid question block removed and trimmed. Empty
   * string when the message was nothing but the block. */
  text: string;
  /** The parsed question, or null when the message had no valid block. */
  question: QuestionSpec | null;
}
declare function parseQuestionBlock(raw: string): ParsedQuestionText;
//#endregion
//#region src/controls.d.ts
/**
 * Shared schema + helpers for the ```agent-controls``` block: the structured
 * parameter panel an agent can emit at the end of a message (mirroring
 * ```agent-question```). Server parsers, transports, and every frontend import
 * this module so there is exactly one validator and one template→style
 * substitution path.
 *
 * A spec is a set of typed controls plus style bindings. Every CSS property is
 * produced through a binding template with `{id}` placeholders — single
 * controls use `"{radius}"`, composites like box-shadow reference several
 * controls in one template.
 *
 * `scope` and the style bindings assume a host DOM to preview on. Non-DOM
 * clients ignore them and render just the input widgets and the Apply
 * round-trip (see the rendering contract in the README).
 *
 * The legacy `carve-controls` fence is accepted during migration.
 */
interface SliderControl {
  id: string;
  type: "slider";
  label: string;
  min: number;
  max: number;
  step?: number;
  /** Suffixed to the numeric value during substitution, e.g. "px". */
  unit?: string;
  value: number;
}
interface ColorControl {
  id: string;
  type: "color";
  label: string;
  value: string;
}
interface SelectControl {
  id: string;
  type: "select";
  label: string;
  options: string[];
  value: string;
}
type Control = SliderControl | ColorControl | SelectControl;
interface StyleBinding {
  /** kebab-case CSS property (e.g. "box-shadow") or a CSS custom property
   * (e.g. "--gutter"). Standard properties must be on the visual allowlist;
   * custom properties bypass it but their values are screened identically. */
  property: string;
  /** Value template; `{id}` placeholders substituted with control values. */
  template: string;
}
interface ElementControlsScope {
  type: "element";
}
interface SelectorControlsScope {
  type: "selector";
  /** A deliberately narrow tag/class selector, e.g. `img.project-images`. */
  selector: string;
  /** Human-readable description shown in the controls card. */
  label?: string;
}
type ControlsScope = ElementControlsScope | SelectorControlsScope;
interface ControlsSpec {
  title?: string;
  /** Chosen by the agent. Missing on legacy specs and treated as `element`.
   * DOM-only concept — non-DOM clients ignore it. */
  scope?: ControlsScope;
  controls: Control[];
  styles: StyleBinding[];
}
/** Current values keyed by control id. Range/text inputs report strings, so
 * both are allowed; substitution and comparison coerce as needed. */
type ControlValues = Record<string, string | number>;
/** Validates an unknown JSON value into a ControlsSpec. Any violation returns
 * null — malformed blocks are left in the message as plain text. */
declare function validateControls(value: unknown): ControlsSpec | null;
/** Initial values keyed by control id — the panel's starting state, seeded by
 * the agent from the element's computed styles. */
declare function initialControlValues(spec: ControlsSpec): ControlValues;
/** Substitutes `{id}` placeholders in every binding template, producing a
 * CSS property → value map ready for inline-style preview or Apply. */
declare function buildStyleMap(spec: ControlsSpec, values: ControlValues): Record<string, string>;
/** The visible user message the Apply button sends into the chat. This is the
 * controls round-trip: the client composes it from the final style map and the
 * spec's scope and sends it as the next user turn. */
declare function composeApplyMessage(styles: Record<string, string>, scope?: ControlsScope): string;
/** Loose equality over value maps: `4` and `"4"` compare equal because range
 * inputs report strings while specs carry numbers. */
declare function valuesEqual(a: ControlValues | undefined, b: ControlValues | undefined): boolean;
interface ParsedControlsText {
  /** The message text with a valid controls block removed and trimmed. Empty
   * string when the message was nothing but the block. */
  text: string;
  /** The parsed spec, or null when the message had no valid block. */
  controls: ControlsSpec | null;
}
declare function parseControlsBlock(raw: string): ParsedControlsText;
//#endregion
//#region src/events.d.ts
/**
 * Version of this event contract. Servers include it on `session_started` so
 * clients replaying buffered events across a deploy can detect skew.
 */
declare const PROTOCOL_VERSION = 1;
/** A small provider-normalized value shown inside an expanded tool-call row,
 * e.g. `{ label: "Command", value: "bun test" }`. */
interface ToolCallDetail {
  label: string;
  value: string;
}
/** Why a turn ended without completing. `user` is a deliberate cancel;
 * `timeout` is the runner's wall-clock limit. Render them differently. */
type AbortReason = "user" | "timeout";
type ChatStreamEvent =
/**
 * The turn is running under this session/thread id. Emitted once near the
 * start of a first turn. Clients persist the id and send it back on the next
 * turn to continue the conversation; a second occurrence with a different id
 * supersedes the first. Not emitted on resumed turns — the client already
 * holds the id it resumed with.
 */
{
  type: "session_started";
  sessionId: string;
  /** Contract version the server speaks; see {@link PROTOCOL_VERSION}. */
  protocolVersion?: number;
} |
/**
 * A completed assistant message. Clients MUST render it as GitHub-flavored
 * markdown (sanitized). Multiple occurrences in one turn are separate
 * messages, in order — not fragments to concatenate.
 */
{
  type: "assistant_text";
  text: string;
} |
/**
 * The agent invoked a tool. Clients MUST show at least `name` inline in the
 * transcript, in stream order relative to assistant text. `summary` is a
 * one-line label; `details` are expandable label/value rows. Neither carries
 * tool output — this is a trace of what ran, not results.
 */
{
  type: "tool_use";
  name: string;
  summary?: string;
  details?: ToolCallDetail[];
} |
/**
 * A structured clarifying question. Clients MUST render the options as
 * selectable choices; the chosen option's label (or a typed free-text reply)
 * is sent verbatim as the next user turn. Selecting locally marks the card
 * answered — no special reply channel exists.
 */
{
  type: "question";
  question: string;
  options: QuestionSpec["options"];
} |
/**
 * A live parameter panel. Clients MUST render each control as an input
 * seeded with its `value`, and on Apply send the message composed by
 * `composeApplyMessage(buildStyleMap(spec, values), spec.scope)` as the next
 * user turn. Non-DOM clients ignore `scope`/`styles` previews and keep the
 * widgets + Apply round-trip. A panel is retired by the next user message.
 */
{
  type: "controls";
  spec: ControlsSpec;
} |
/**
 * Raw stderr from the agent CLI. Diagnostic channel — clients MAY ignore it
 * or surface it in a collapsed log. Never render it as assistant prose.
 */
{
  type: "stderr";
  chunk: string;
} |
/** Terminal: the turn completed. `exitCode` 0 is success. */
{
  type: "done";
  exitCode: number;
} |
/** Terminal: the turn was killed before completing. See {@link AbortReason};
 * absent means an unspecified abort (treat as `user`). */
{
  type: "aborted";
  reason?: AbortReason;
} |
/** Terminal: the turn failed. `message` is human-readable and safe to show. */
{
  type: "error";
  message: string;
};
/** True for the three events that end a turn's stream: `done`, `aborted`,
 * `error`. After one of these, no further events arrive for the turn. */
declare function isTerminalEvent(ev: ChatStreamEvent): boolean;
//#endregion
export { ParsedQuestionText as C, valuesEqual as S, parseQuestionBlock as T, buildStyleMap as _, isTerminalEvent as a, parseControlsBlock as b, ControlValues as c, ElementControlsScope as d, ParsedControlsText as f, StyleBinding as g, SliderControl as h, ToolCallDetail as i, ControlsScope as l, SelectorControlsScope as m, ChatStreamEvent as n, ColorControl as o, SelectControl as p, PROTOCOL_VERSION as r, Control as s, AbortReason as t, ControlsSpec as u, composeApplyMessage as v, QuestionSpec as w, validateControls as x, initialControlValues as y };
//# sourceMappingURL=events-DznAaxaP.d.ts.map