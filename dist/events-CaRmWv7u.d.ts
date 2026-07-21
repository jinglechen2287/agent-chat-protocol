import * as z from "zod";
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
 * ```agent-question```).
 *
 * The shared contract covers the *widgets*: typed controls (slider / color /
 * select), their validation, and the current-values model. Anything beyond
 * that — carve's CSS style bindings and scopes, for example — is an app
 * extension: extra fields on the block that the core validator ignores, and
 * that an app-supplied validator (the `validate` parameter of
 * `parseControlsBlock`, the bridge's `controlsValidator` option, the
 * `mapEvent` option of `consumeSseResponse`) lifts into a richer spec. A
 * client that doesn't understand an extension renders the widgets and the
 * Apply round-trip and ignores the rest.
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
  /** Display unit for the numeric value, e.g. "px". */
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
interface ControlsSpec {
  title?: string;
  controls: Control[];
}
/** Current values keyed by control id. Range/text inputs report strings, so
 * both are allowed; comparison and app-side consumption coerce as needed. */
type ControlValues = Record<string, string | number>;
/**
 * Validates an unknown JSON value into the core ControlsSpec. Any violation
 * returns null — malformed blocks are left in the message as plain text.
 * Unknown fields (app extensions) are ignored, not rejected: extension
 * validation belongs to the app validator layered on top.
 */
declare function validateControls(value: unknown): ControlsSpec | null;
/** Initial values keyed by control id — the panel's starting state. */
declare function initialControlValues(spec: ControlsSpec): ControlValues;
/** Loose equality over value maps: `4` and `"4"` compare equal because range
 * inputs report strings while specs carry numbers. */
declare function valuesEqual(a: ControlValues | undefined, b: ControlValues | undefined): boolean;
interface ParsedControlsText<TSpec extends ControlsSpec = ControlsSpec> {
  /** The message text with a valid controls block removed and trimmed. Empty
   * string when the message was nothing but the block. */
  text: string;
  /** The parsed spec, or null when the message had no valid block. */
  controls: TSpec | null;
}
/**
 * Extracts the first controls block. `validate` defaults to the core
 * validator; apps with extensions pass their own (e.g. carve's CSS-binding
 * validator) — when it rejects, the block is left in the prose as plain text,
 * exactly like a malformed block. The overloads keep the narrowed spec type
 * tied to the presence of a custom validator.
 */
declare function parseControlsBlock(raw: string): ParsedControlsText;
declare function parseControlsBlock<TSpec extends ControlsSpec>(raw: string, validate: (value: unknown) => TSpec | null): ParsedControlsText<TSpec>;
//#endregion
//#region src/view.d.ts
/**
 * Every component the agent may emit. `prompt` is the exact line VIEW_PROMPT
 * teaches for the entry — keep it terse: shape, then when to use it.
 */
declare const VIEW_CATALOG: {
  readonly Section: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Section">;
      title: z.ZodOptional<z.ZodString>;
      subtitle: z.ZodOptional<z.ZodString>;
      children: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    readonly prompt: "Section {title?, subtitle?, children[]} — top-level report region with a heading";
  };
  readonly Grid: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Grid">;
      columns: z.ZodOptional<z.ZodNumber>;
      children: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    readonly prompt: "Grid {columns? 2-4, children[]} — side-by-side cards/stats; collapses on phones";
  };
  readonly Stack: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Stack">;
      direction: z.ZodOptional<z.ZodEnum<{
        row: "row";
        column: "column";
      }>>;
      gap: z.ZodOptional<z.ZodEnum<{
        s: "s";
        m: "m";
        l: "l";
      }>>;
      children: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    readonly prompt: "Stack {direction?, gap?, children[]} — plain vertical (default) or horizontal group";
  };
  readonly Card: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Card">;
      title: z.ZodOptional<z.ZodString>;
      children: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    readonly prompt: "Card {title?, children[]} — bordered grouping inside a Grid or Section";
  };
  readonly Divider: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Divider">;
    }, z.core.$strip>;
    readonly prompt: "Divider {} — horizontal rule";
  };
  readonly Heading: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Heading">;
      level: z.ZodNumber;
      text: z.ZodString;
    }, z.core.$strip>;
    readonly prompt: "Heading {level 1-4, text}";
  };
  readonly Text: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Text">;
      value: z.ZodString;
      variant: z.ZodOptional<z.ZodEnum<{
        body: "body";
        caption: "caption";
        muted: "muted";
      }>>;
    }, z.core.$strip>;
    readonly prompt: "Text {value, variant?: body|caption|muted} — one plain paragraph";
  };
  readonly Markdown: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Markdown">;
      value: z.ZodString;
    }, z.core.$strip>;
    readonly prompt: "Markdown {value} — rich prose: links, lists, inline code";
  };
  readonly Badge: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Badge">;
      label: z.ZodString;
      variant: z.ZodOptional<z.ZodEnum<{
        error: "error";
        success: "success";
        neutral: "neutral";
        info: "info";
        warn: "warn";
      }>>;
    }, z.core.$strip>;
    readonly prompt: "Badge {label, variant?: neutral|info|success|warn|error} — small status chip";
  };
  readonly Callout: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Callout">;
      variant: z.ZodEnum<{
        error: "error";
        success: "success";
        info: "info";
        warn: "warn";
      }>;
      title: z.ZodOptional<z.ZodString>;
      children: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    readonly prompt: "Callout {variant: info|success|warn|error, title?, children[]} — highlighted finding";
  };
  readonly Stat: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Stat">;
      label: z.ZodString;
      value: z.ZodString;
      delta: z.ZodOptional<z.ZodString>;
      trend: z.ZodOptional<z.ZodEnum<{
        up: "up";
        down: "down";
        flat: "flat";
      }>>;
      spark: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
    }, z.core.$strip>;
    readonly prompt: "Stat {label, value, delta?, trend?: up|down|flat, spark?: number[]} — KPI tile";
  };
  readonly Table: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Table">;
      columns: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        label: z.ZodString;
        align: z.ZodOptional<z.ZodEnum<{
          left: "left";
          center: "center";
          right: "right";
        }>>;
        format: z.ZodOptional<z.ZodEnum<{
          number: "number";
          date: "date";
          percent: "percent";
        }>>;
      }, z.core.$strip>>;
      rows: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>>;
      sortable: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    readonly prompt: "Table {columns: {key,label,align?,format?: number|percent|date}[], rows, sortable?} — aggregate first, ≤200 rows";
  };
  readonly Chart: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Chart">;
      kind: z.ZodEnum<{
        line: "line";
        bar: "bar";
        area: "area";
        pie: "pie";
        scatter: "scatter";
        heatmap: "heatmap";
      }>;
      series: z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        points: z.ZodArray<z.ZodObject<{
          x: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
          y: z.ZodNumber;
        }, z.core.$strip>>;
      }, z.core.$strip>>;
      xLabel: z.ZodOptional<z.ZodString>;
      yLabel: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    readonly prompt: "Chart {kind: line|bar|area|pie|scatter|heatmap, series: {label, points:{x,y}[]}[], xLabel?, yLabel?} — downsample to ≤300 points";
  };
  readonly Progress: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Progress">;
      label: z.ZodOptional<z.ZodString>;
      value: z.ZodNumber;
      max: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
    readonly prompt: "Progress {label?, value, max?} — completion bar";
  };
  readonly Code: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Code">;
      value: z.ZodString;
      language: z.ZodOptional<z.ZodString>;
      filename: z.ZodOptional<z.ZodString>;
      highlight: z.ZodOptional<z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>>;
    }, z.core.$strip>;
    readonly prompt: "Code {value, language?, filename?, highlight?: [from,to][]} — syntax-highlighted source";
  };
  readonly Diff: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Diff">;
      value: z.ZodString;
      filename: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    readonly prompt: "Diff {value (unified diff), filename?} — colored add/remove rendering";
  };
  readonly Diagram: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Diagram">;
      source: z.ZodString;
    }, z.core.$strip>;
    readonly prompt: "Diagram {source} — Mermaid: flowcharts, sequence, architecture sketches";
  };
  readonly Timeline: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Timeline">;
      items: z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        detail: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
          done: "done";
          active: "active";
          pending: "pending";
          failed: "failed";
        }>;
      }, z.core.$strip>>;
    }, z.core.$strip>;
    readonly prompt: "Timeline {items: {label, detail?, status: done|active|pending|failed}[]} — ordered narrative";
  };
  readonly Tabs: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Tabs">;
      items: z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        children: z.ZodArray<z.ZodString>;
      }, z.core.$strip>>;
    }, z.core.$strip>;
    readonly prompt: "Tabs {items: {label, children[]}[]} — switch between sub-sections locally";
  };
  readonly Details: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Details">;
      summary: z.ZodString;
      children: z.ZodArray<z.ZodString>;
      open: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    readonly prompt: "Details {summary, children[], open?} — collapsible section for secondary depth";
  };
  readonly Image: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Image">;
      src: z.ZodString;
      alt: z.ZodString;
      caption: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    readonly prompt: "Image {src, alt, caption?}";
  };
  readonly Input: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Input">;
      bind: z.ZodString;
      label: z.ZodString;
      placeholder: z.ZodOptional<z.ZodString>;
      value: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    readonly prompt: "Input {bind: $var, label, placeholder?, value?} — free text";
  };
  readonly Select: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Select">;
      bind: z.ZodString;
      label: z.ZodString;
      options: z.ZodArray<z.ZodString>;
      value: z.ZodString;
    }, z.core.$strip>;
    readonly prompt: "Select {bind: $var, label, options[], value}";
  };
  readonly Slider: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Slider">;
      bind: z.ZodString;
      label: z.ZodString;
      min: z.ZodNumber;
      max: z.ZodNumber;
      step: z.ZodOptional<z.ZodNumber>;
      value: z.ZodNumber;
    }, z.core.$strip>;
    readonly prompt: "Slider {bind: $var, label, min, max, step?, value}";
  };
  readonly Checkbox: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Checkbox">;
      bind: z.ZodString;
      label: z.ZodString;
      checked: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    readonly prompt: "Checkbox {bind: $var, label, checked?}";
  };
  readonly DateRange: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"DateRange">;
      bind: z.ZodString;
      label: z.ZodString;
      start: z.ZodOptional<z.ZodString>;
      end: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    readonly prompt: "DateRange {bind: $var, label, start?, end?} — ISO dates";
  };
  readonly Button: {
    readonly schema: z.ZodObject<{
      id: z.ZodString;
      type: z.ZodLiteral<"Button">;
      label: z.ZodString;
      variant: z.ZodOptional<z.ZodEnum<{
        primary: "primary";
        secondary: "secondary";
        ghost: "ghost";
      }>>;
      message: z.ZodOptional<z.ZodString>;
      href: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    readonly prompt: "Button {label, variant?: primary|secondary|ghost, message? | href?} — message templates send \"{$var}\"-interpolated text as the next user turn; href opens a link. Exactly one of the two.";
  };
};
type ViewComponent = { [K in keyof typeof VIEW_CATALOG]: z.infer<(typeof VIEW_CATALOG)[K]["schema"]>; }[keyof typeof VIEW_CATALOG];
interface ViewSpec {
  /** Reachable components in traversal order; `components[0].id === "root"`. */
  components: ViewComponent[];
}
/**
 * Validates an unknown `{ components }` value into a ViewSpec. Invalid
 * components are skipped, duplicate ids keep the first occurrence, and the
 * reference graph is reduced to a tree: reachable from `root`, each id
 * rendered at most once, repeat/cyclic/dangling/too-deep references pruned.
 * Returns null when no valid `root` component exists.
 */
declare function validateViewSpec(value: unknown): ViewSpec | null;
interface ParsedViewText {
  /** The message text with a valid view block removed and trimmed. */
  text: string;
  /** The parsed view, or null when the message had no renderable block. */
  view: ViewSpec | null;
}
/**
 * Extracts the first ```agent-view``` block: one JSON component per line.
 * Malformed or unknown lines are skipped; a block with no valid root (or one
 * over the size ceiling) is left in the prose as plain text, exactly like a
 * malformed controls block.
 */
declare function parseViewBlock(raw: string): ParsedViewText;
/** The prompt section that teaches the view grammar. Injected alongside
 * QUESTION_PROMPT via --append-system-prompt / developerInstructions; a test
 * asserts every catalog entry appears here, so prompt and validator move
 * together. */
declare const VIEW_PROMPT: string;
//#endregion
//#region src/events.d.ts
/**
 * Version of this event contract. Servers include it on `session_started` so
 * clients replaying buffered events across a deploy can detect skew.
 */
declare const PROTOCOL_VERSION = 5;
/** A small provider-normalized value shown inside an expanded tool-call row,
 * e.g. `{ label: "Command", value: "bun test" }`. */
interface ToolCallDetail {
  label: string;
  value: string;
}
/** Provider-normalized task identity carried by task-management tool calls.
 * It lets clients correlate a later TaskUpdate with its earlier TaskCreate. */
interface ToolTaskMetadata {
  id?: string;
  subject?: string;
  status?: string;
}
/** One provider-normalized step from a Codex plan/todo snapshot. */
interface ToolPlanItem {
  text: string;
  status: string;
}
type BackgroundAgentStatus = "pending" | "running" | "completed" | "failed" | "interrupted";
interface BackgroundAgentProgress {
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
  lastToolName?: string;
}
/** A complete, replace-in-place snapshot of one provider background agent. */
interface BackgroundAgent {
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
 * A fragment of the assistant message still being written. `index` counts
 * assistant messages within the turn from 0, so fragments belong to the
 * message the next `assistant_text` will deliver.
 *
 * Clients MUST append `delta` to a scratch buffer for `index` and MAY render
 * that buffer as in-progress prose, and MUST discard the buffer when the
 * `assistant_text` for the same index arrives — that event is the transcript
 * message, and the buffer is never one. Fragments are best-effort: they are
 * not persisted, they stop at a generative-UI block (whose rendered card
 * would otherwise be preceded by its raw markup), and a turn may deliver an
 * `assistant_text` with no preceding fragments at all.
 */
{
  type: "assistant_text_delta";
  index: number;
  delta: string;
} |
/**
 * The agent invoked a tool. Clients MUST show at least `name` inline in the
 * transcript and preserve every event in stream order relative to assistant
 * text. `summary` is an optional concise description; `details` are optional
 * curated label/value metadata. Neither carries tool output — this is a trace
 * of what ran, not results. Grouping and expansion layout are non-normative
 * client presentation choices; see the README guidance.
 */
{
  type: "tool_use";
  name: string;
  summary?: string;
  details?: ToolCallDetail[];
  task?: ToolTaskMetadata;
  plan?: ToolPlanItem[];
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
 * seeded with its `value`, and on Apply send an app-defined message
 * composed from the final values as the next user turn. Apps may extend
 * the spec with extra fields via their own validators (carve layers CSS
 * style bindings this way); a client that doesn't understand an extension
 * renders the widgets + Apply round-trip and ignores the rest. A panel is
 * retired by the next user message.
 */
{
  type: "controls";
  spec: ControlsSpec;
} |
/**
 * A generative-UI view composed from the shared component catalog.
 * Clients MUST render known components natively in graph order, skip
 * unknown or invalid ones (the rest of the view still renders), and treat
 * the event as a transcript message alongside `assistant_text`. Inputs
 * bind view-local $vars; a Button's `message` template — `{$var}` tokens
 * interpolated from those values — is sent verbatim as the next user turn,
 * and `href` Buttons open externally. Views are static content otherwise:
 * no handlers, no expressions, no executable payloads.
 */
{
  type: "view";
  spec: ViewSpec;
} |
/**
 * A context-window usage snapshot for the turn. Non-terminal and may arrive
 * more than once (each supersedes the last); clients render the latest as a
 * context meter. `contextWindow` is absent when the provider reported no
 * window and none could be resolved — show `contextTokens` without a
 * percentage in that case. Counts are provider-reported and may be
 * approximate; clamp the meter at 100% rather than treating overflow as an
 * error.
 */
{
  type: "context_usage";
  /** Tokens occupying the context window, per the provider's best report. */
  contextTokens: number;
  /** Total window size in tokens, when known. */
  contextWindow?: number;
  /** Model that produced the usage, when known. */
  model?: string;
} |
/**
 * The canonical title for the chat containing this turn. Non-terminal and
 * emitted when an asynchronous title generator replaces the app's immediate
 * fallback. Clients MUST update the chat/thread title without adding a
 * transcript message.
 */
{
  type: "thread_title";
  title: string;
} |
/**
 * A full background-agent lifecycle snapshot. Non-terminal and mutable:
 * clients MUST upsert by `agent.id`, replacing the prior snapshot instead
 * of appending a transcript message for every progress event. Status is one
 * of `pending`, `running`, `completed`, `failed`, or `interrupted`; provider
 * ids, spawn correlation, progress, summaries, errors, and Unix-millisecond
 * timestamps remain available on the snapshot.
 */
{
  type: "background_agent_updated";
  agent: BackgroundAgent;
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
export { QuestionSpec as A, SelectControl as C, validateControls as D, parseControlsBlock as E, valuesEqual as O, ParsedControlsText as S, initialControlValues as T, validateViewSpec as _, ChatStreamEvent as a, ControlValues as b, ToolPlanItem as c, ParsedViewText as d, VIEW_CATALOG as f, parseViewBlock as g, ViewSpec as h, BackgroundAgentStatus as i, parseQuestionBlock as j, ParsedQuestionText as k, ToolTaskMetadata as l, ViewComponent as m, BackgroundAgent as n, PROTOCOL_VERSION as o, VIEW_PROMPT as p, BackgroundAgentProgress as r, ToolCallDetail as s, AbortReason as t, isTerminalEvent as u, ColorControl as v, SliderControl as w, ControlsSpec as x, Control as y };
//# sourceMappingURL=events-CaRmWv7u.d.ts.map