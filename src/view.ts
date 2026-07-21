/**
 * The ```agent-view``` grammar: a generative-UI view composed from a fixed
 * component catalog, one JSON object per line.
 *
 * The catalog is the whole security and coherence story. The agent can only
 * name components defined here; it picks semantics (variants, levels,
 * statuses) and never pixels (no color/spacing/font props anywhere). Each
 * entry pairs its zod schema with the prompt line that teaches it, so the
 * validator and the prompt live one line apart and a test keeps VIEW_PROMPT
 * covering every entry.
 *
 * Degradation rules mirror controls.ts: an invalid line is skipped and the
 * rest of the view renders; a view with no valid root degrades to plain
 * text. Component references form a tree — each id renders at most once, and
 * repeat, cyclic, dangling, or too-deep references are pruned rather than
 * failing the view.
 */

// Namespace import: zod's entry re-exports `z` as a named binding in a way
// vitest's ESM/CJS interop resolves to undefined; the star form is stable
// under both bun and vitest.
import * as z from "zod";
import { VIEW_BLOCK_NAME } from "./prompt";

const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
/** Client-local state variables: `$region`, `$granularity`. */
const BIND_RE = /^\$[a-zA-Z][a-zA-Z0-9_]*$/;

const id = z.string().regex(ID_RE).max(40);
const ref = z.string().regex(ID_RE).max(40);
const children = z.array(ref).max(40);
const label = z.string().min(1).max(80);
const shortText = z.string().max(500);
const longText = z.string().max(20_000);

const cell = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);

function component<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
  // .strip() (the default) drops unknown props: a newer prompt's extra field
  // must not reject the whole component on an older client.
  return z.object({ id, type: z.literal(type), ...shape });
}

const button = component("Button", {
  label,
  variant: z.enum(["primary", "secondary", "ghost"]).optional(),
  /** Template sent as the next user turn; `{$var}` interpolates input state. */
  message: z.string().min(1).max(1_000).optional(),
  /** External link opened in a new tab. */
  href: z.string().url().max(2_000).optional(),
}).refine((b) => (b.message === undefined) !== (b.href === undefined), {
  message: "Button requires exactly one of message or href",
});

/**
 * Every component the agent may emit. `prompt` is the exact line VIEW_PROMPT
 * teaches for the entry — keep it terse: shape, then when to use it.
 */
export const VIEW_CATALOG = {
  // Layout
  Section: {
    schema: component("Section", { title: label.optional(), subtitle: shortText.optional(), children }),
    prompt: 'Section {title?, subtitle?, children[]} — top-level report region with a heading',
  },
  Grid: {
    schema: component("Grid", { columns: z.number().int().min(2).max(4).optional(), children }),
    prompt: "Grid {columns? 2-4, children[]} — side-by-side cards/stats; collapses on phones",
  },
  Stack: {
    schema: component("Stack", {
      direction: z.enum(["row", "column"]).optional(),
      gap: z.enum(["s", "m", "l"]).optional(),
      children,
    }),
    prompt: "Stack {direction?, gap?, children[]} — plain vertical (default) or horizontal group",
  },
  Card: {
    schema: component("Card", { title: label.optional(), children }),
    prompt: "Card {title?, children[]} — bordered grouping inside a Grid or Section",
  },
  Divider: {
    schema: component("Divider", {}),
    prompt: "Divider {} — horizontal rule",
  },
  // Typography
  Heading: {
    schema: component("Heading", { level: z.number().int().min(1).max(4), text: label }),
    prompt: "Heading {level 1-4, text}",
  },
  Text: {
    schema: component("Text", { value: longText, variant: z.enum(["body", "caption", "muted"]).optional() }),
    prompt: "Text {value, variant?: body|caption|muted} — one plain paragraph",
  },
  Markdown: {
    schema: component("Markdown", { value: longText }),
    prompt: "Markdown {value} — rich prose: links, lists, inline code",
  },
  Badge: {
    schema: component("Badge", {
      label,
      variant: z.enum(["neutral", "info", "success", "warn", "error"]).optional(),
    }),
    prompt: "Badge {label, variant?: neutral|info|success|warn|error} — small status chip",
  },
  Callout: {
    schema: component("Callout", {
      variant: z.enum(["info", "success", "warn", "error"]),
      title: label.optional(),
      children,
    }),
    prompt: "Callout {variant: info|success|warn|error, title?, children[]} — highlighted finding",
  },
  // Data
  Stat: {
    schema: component("Stat", {
      label,
      value: z.string().min(1).max(40),
      delta: z.string().max(40).optional(),
      trend: z.enum(["up", "down", "flat"]).optional(),
      spark: z.array(z.number()).max(60).optional(),
    }),
    prompt: "Stat {label, value, delta?, trend?: up|down|flat, spark?: number[]} — KPI tile",
  },
  Table: {
    schema: component("Table", {
      columns: z.array(z.object({
        key: z.string().min(1).max(40),
        label,
        align: z.enum(["left", "center", "right"]).optional(),
        format: z.enum(["number", "percent", "date"]).optional(),
      })).min(1).max(12),
      rows: z.array(z.record(z.string(), cell)).max(200),
      sortable: z.boolean().optional(),
    }),
    prompt: "Table {columns: {key,label,align?,format?: number|percent|date}[], rows, sortable?} — aggregate first, ≤200 rows",
  },
  Chart: {
    schema: component("Chart", {
      kind: z.enum(["line", "bar", "area", "pie", "scatter", "heatmap"]),
      series: z.array(z.object({
        label,
        points: z.array(z.object({ x: z.union([z.string().max(40), z.number()]), y: z.number() })).max(300),
      })).min(1).max(8),
      xLabel: label.optional(),
      yLabel: label.optional(),
    }),
    prompt: "Chart {kind: line|bar|area|pie|scatter|heatmap, series: {label, points:{x,y}[]}[], xLabel?, yLabel?} — downsample to ≤300 points",
  },
  Progress: {
    schema: component("Progress", { label: label.optional(), value: z.number(), max: z.number().positive().optional() }),
    prompt: "Progress {label?, value, max?} — completion bar",
  },
  // Code & domain
  Code: {
    schema: component("Code", {
      value: longText,
      language: z.string().max(24).optional(),
      filename: z.string().max(200).optional(),
      highlight: z.array(z.tuple([z.number().int().positive(), z.number().int().positive()])).max(20).optional(),
    }),
    prompt: "Code {value, language?, filename?, highlight?: [from,to][]} — syntax-highlighted source",
  },
  Diff: {
    schema: component("Diff", { value: longText, filename: z.string().max(200).optional() }),
    prompt: "Diff {value (unified diff), filename?} — colored add/remove rendering",
  },
  Diagram: {
    schema: component("Diagram", { source: z.string().min(1).max(10_000) }),
    prompt: "Diagram {source} — Mermaid: flowcharts, sequence, architecture sketches",
  },
  Timeline: {
    schema: component("Timeline", {
      items: z.array(z.object({
        label,
        detail: shortText.optional(),
        status: z.enum(["done", "active", "pending", "failed"]),
      })).min(1).max(50),
    }),
    prompt: "Timeline {items: {label, detail?, status: done|active|pending|failed}[]} — ordered narrative",
  },
  // Local interactive
  Tabs: {
    schema: component("Tabs", {
      items: z.array(z.object({ label, children })).min(2).max(8),
    }),
    prompt: "Tabs {items: {label, children[]}[]} — switch between sub-sections locally",
  },
  Details: {
    schema: component("Details", { summary: label, children, open: z.boolean().optional() }),
    prompt: "Details {summary, children[], open?} — collapsible section for secondary depth",
  },
  Image: {
    schema: component("Image", { src: z.string().url().max(2_000), alt: shortText, caption: shortText.optional() }),
    prompt: "Image {src, alt, caption?}",
  },
  // Inputs — write $vars; inert until a Button template reads them
  Input: {
    schema: component("Input", {
      bind: z.string().regex(BIND_RE),
      label,
      placeholder: shortText.optional(),
      value: shortText.optional(),
    }),
    prompt: "Input {bind: $var, label, placeholder?, value?} — free text",
  },
  Select: {
    schema: component("Select", {
      bind: z.string().regex(BIND_RE),
      label,
      options: z.array(z.string().min(1).max(80)).min(2).max(24),
      value: z.string().max(80),
    }),
    prompt: "Select {bind: $var, label, options[], value}",
  },
  Slider: {
    schema: component("Slider", {
      bind: z.string().regex(BIND_RE),
      label,
      min: z.number(),
      max: z.number(),
      step: z.number().positive().optional(),
      value: z.number(),
    }),
    prompt: "Slider {bind: $var, label, min, max, step?, value}",
  },
  Checkbox: {
    schema: component("Checkbox", {
      bind: z.string().regex(BIND_RE),
      label,
      checked: z.boolean().optional(),
    }),
    prompt: "Checkbox {bind: $var, label, checked?}",
  },
  DateRange: {
    schema: component("DateRange", {
      bind: z.string().regex(BIND_RE),
      label,
      start: z.string().max(20).optional(),
      end: z.string().max(20).optional(),
    }),
    prompt: "DateRange {bind: $var, label, start?, end?} — ISO dates",
  },
  // Actions
  Button: {
    schema: button,
    prompt: 'Button {label, variant?: primary|secondary|ghost, message? | href?} — message templates send "{$var}"-interpolated text as the next user turn; href opens a link. Exactly one of the two.',
  },
} as const;

export type ViewComponent = {
  [K in keyof typeof VIEW_CATALOG]: z.infer<(typeof VIEW_CATALOG)[K]["schema"]>;
}[keyof typeof VIEW_CATALOG];

export interface ViewSpec {
  /** Reachable components in traversal order; `components[0].id === "root"`. */
  components: ViewComponent[];
}

/** Defensive ceilings — beyond them a block degrades to plain text. */
const MAX_COMPONENTS = 100;
const MAX_DEPTH = 10;
const MAX_BLOCK_BYTES = 65_536;
/** Input-side work bound: entries past this are never schema-validated, so a
 * hostile frame cannot buy unbounded parse work. Generous headroom over the
 * render cap keeps legitimate skipped-line noise from starving late ids. */
const MAX_VALIDATED_ENTRIES = MAX_COMPONENTS * 4;

function validateComponent(value: unknown): ViewComponent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const type = (value as Record<string, unknown>).type;
  if (typeof type !== "string") return null;
  const entry = (VIEW_CATALOG as Record<string, { schema: z.ZodType }>)[type];
  if (!entry) return null;
  const parsed = entry.schema.safeParse(value);
  return parsed.success ? (parsed.data as ViewComponent) : null;
}

/** The ids a component renders as children, in slot order. */
function childRefs(c: ViewComponent): string[] {
  if ("children" in c) return c.children;
  if (c.type === "Tabs") return c.items.flatMap((item) => item.children);
  return [];
}

/** Returns a copy of the component keeping only child refs in `keep`, in the
 * order `keep` lists them (which is first-occurrence order per slot). */
function withPrunedRefs(c: ViewComponent, keep: (id: string) => boolean): ViewComponent {
  if ("children" in c) {
    const seen = new Set<string>();
    const pruned = c.children.filter((child) => {
      if (seen.has(child) || !keep(child)) return false;
      seen.add(child);
      return true;
    });
    return { ...c, children: pruned };
  }
  if (c.type === "Tabs") {
    const seen = new Set<string>();
    return {
      ...c,
      items: c.items.map((item) => ({
        ...item,
        children: item.children.filter((child) => {
          if (seen.has(child) || !keep(child)) return false;
          seen.add(child);
          return true;
        }),
      })),
    };
  }
  return c;
}

/**
 * Validates an unknown `{ components }` value into a ViewSpec. Invalid
 * components are skipped, duplicate ids keep the first occurrence, and the
 * reference graph is reduced to a tree: reachable from `root`, each id
 * rendered at most once, repeat/cyclic/dangling/too-deep references pruned.
 * Returns null when no valid `root` component exists.
 */
export function validateViewSpec(value: unknown): ViewSpec | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).components;
  if (!Array.isArray(raw)) return null;

  const byId = new Map<string, ViewComponent>();
  for (const entry of raw.slice(0, MAX_VALIDATED_ENTRIES)) {
    const parsed = validateComponent(entry);
    if (parsed && !byId.has(parsed.id)) byId.set(parsed.id, parsed);
  }
  const root = byId.get("root");
  if (!root) return null;

  // Depth-limited traversal from root. `placed` enforces render-once — it
  // also breaks cycles, since a back-edge always points at a placed id.
  const placed = new Set<string>(["root"]);
  const ordered: ViewComponent[] = [];
  const visit = (component: ViewComponent, depth: number): void => {
    const keep = (child: string): boolean => {
      if (depth >= MAX_DEPTH || placed.size >= MAX_COMPONENTS) return false;
      if (placed.has(child) || !byId.has(child)) return false;
      placed.add(child);
      return true;
    };
    const pruned = withPrunedRefs(component, keep);
    ordered.push(pruned);
    for (const child of childRefs(pruned)) visit(byId.get(child)!, depth + 1);
  };
  visit(root, 1);

  return { components: ordered };
}

export interface ParsedViewText {
  /** The message text with a valid view block removed and trimmed. */
  text: string;
  /** The parsed view, or null when the message had no renderable block. */
  view: ViewSpec | null;
}

/** Matches the first agent-view fenced block; the info string must be exactly
 * the block name so ordinary ```json blocks are ignored. */
const BLOCK_RE = new RegExp(
  "```" + VIEW_BLOCK_NAME + "[^\\S\\r\\n]*\\r?\\n([\\s\\S]*?)\\r?\\n?```",
);

/**
 * Extracts the first ```agent-view``` block: one JSON component per line.
 * Malformed or unknown lines are skipped; a block with no valid root (or one
 * over the size ceiling) is left in the prose as plain text, exactly like a
 * malformed controls block.
 */
export function parseViewBlock(raw: string): ParsedViewText {
  const match = BLOCK_RE.exec(raw);
  if (!match) return { text: raw, view: null };

  const body = match[1] ?? "";
  let view: ViewSpec | null = null;
  // The ceiling is in bytes: measure the encoded length, since a multi-byte
  // payload can be several times its UTF-16 string length.
  if (new TextEncoder().encode(body).length <= MAX_BLOCK_BYTES) {
    const components: unknown[] = [];
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        components.push(JSON.parse(trimmed));
      } catch {
        // Skipped: a bad line must not take the view down with it.
      }
    }
    view = validateViewSpec({ components });
  }
  if (!view) return { text: raw, view: null };

  const text = (raw.slice(0, match.index) + raw.slice(match.index + match[0].length))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, view };
}

/** The prompt section that teaches the view grammar. Injected alongside
 * QUESTION_PROMPT via --append-system-prompt / developerInstructions; a test
 * asserts every catalog entry appears here, so prompt and validator move
 * together. */
export const VIEW_PROMPT: string = [
  "- When a response is best shown as a report, dashboard, or data view (metrics, comparisons, timelines, code changes), compose it from the component catalog by ending the message with a view block. Prefer prose for ordinary answers; emit at most one view per message:",
  "  ```" + VIEW_BLOCK_NAME,
  '  {"id":"root","type":"Section","title":"Weekly usage","children":["kpis","detail"]}',
  '  {"id":"kpis","type":"Grid","children":["s1","s2"]}',
  '  {"id":"s1","type":"Stat","label":"Turns","value":"482","trend":"up"}',
  '  {"id":"s2","type":"Stat","label":"Errors","value":"3","trend":"down"}',
  '  {"id":"detail","type":"Text","value":"Traffic grew 12% week over week."}',
  "  ```",
  "- Rules: one JSON object per line, no wrapping array. The entry component MUST have id \"root\". Containers reference children by id; define every referenced id. Keep views under ~40 components. Aggregate data first — tables ≤200 rows, chart series ≤300 points.",
  "- Pick components for meaning, never styling — there are no color or layout-tuning props. Inputs write client-side $vars; a Button's message template (\"Rerun for {$region}\") sends the interpolated text as the user's next message. Use href Buttons for external links.",
  "- Catalog:",
  ...Object.entries(VIEW_CATALOG).map(([name, entry]) => `  - ${name}: ${entry.prompt.replace(`${name} `, "")}`),
].join("\n");
