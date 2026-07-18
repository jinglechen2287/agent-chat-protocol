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

export interface SliderControl {
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

export interface ColorControl {
  id: string;
  type: "color";
  label: string;
  value: string;
}

export interface SelectControl {
  id: string;
  type: "select";
  label: string;
  options: string[];
  value: string;
}

export type Control = SliderControl | ColorControl | SelectControl;

export interface StyleBinding {
  /** kebab-case CSS property, e.g. "box-shadow". */
  property: string;
  /** Value template; `{id}` placeholders substituted with control values. */
  template: string;
}

export interface ElementControlsScope {
  type: "element";
}

export interface SelectorControlsScope {
  type: "selector";
  /** A deliberately narrow tag/class selector, e.g. `img.project-images`. */
  selector: string;
  /** Human-readable description shown in the controls card. */
  label?: string;
}

export type ControlsScope = ElementControlsScope | SelectorControlsScope;

export interface ControlsSpec {
  title?: string;
  /** Chosen by the agent. Missing on legacy specs and treated as `element`.
   * DOM-only concept — non-DOM clients ignore it. */
  scope?: ControlsScope;
  controls: Control[];
  styles: StyleBinding[];
}

/** Current values keyed by control id. Range/text inputs report strings, so
 * both are allowed; substitution and comparison coerce as needed. */
export type ControlValues = Record<string, string | number>;

/** Defensive ceilings — the agent is asked for less; a runaway block should
 * degrade to plain text rather than flood the client. */
const MAX_CONTROLS = 12;
const MAX_STYLES = 8;
const MAX_SELECT_OPTIONS = 12;
const MAX_LABEL_LENGTH = 40;
const MAX_TITLE_LENGTH = 60;
const MAX_TEMPLATE_LENGTH = 200;
const MAX_SCOPE_SELECTOR_LENGTH = 160;
const MAX_SCOPE_LABEL_LENGTH = 60;

const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const PROPERTY_RE = /^-?[a-z][a-z-]*$/;
/** Stable shared scopes are intentionally limited to an optional tag plus
 * one or more classes. This excludes broad tag-only, positional, relational,
 * and selector-list targeting while covering semantic and CSS-module classes. */
const SCOPE_SELECTOR_RE = /^(?:[a-z][a-z0-9-]*)?(?:\.[A-Za-z_-][A-Za-z0-9_-]*)+$/;
const PLACEHOLDER_RE = /\{([^{}]*)\}/g;
/** Screens templates and substituted values. Beyond URL-bearing syntax, a
 * value must stay a single CSS declaration: `;` and newlines would smuggle
 * extra declarations into cssText or the Apply message. (Braces can't be
 * screened here — templates legitimately contain `{id}` placeholders.) */
const UNSAFE_CSS_VALUE_RE =
  /(?:url\s*\(|expression\s*\(|@import|\/\*|\\|;|[\r\n])/i;
/** Extra screen for fully substituted values, where braces have no legitimate
 * use and would allow escaping a rule body in a stylesheet context. */
const UNSAFE_SUBSTITUTED_VALUE_RE = /[{}]/;

/** Properties intentionally supported by the inline preview. Keeping this
 * list visual and URL-free prevents an assistant-authored controls block from
 * turning the user's browser into a network-request primitive. `filter` and
 * `backdrop-filter` are useful for visual tuning, so their values are also
 * screened for URL-bearing syntax below. */
const ALLOWED_STYLE_PROPERTIES = new Set([
  "color",
  "background-color",
  "opacity",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-shadow",
  "border",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "border-width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-style",
  "border-color",
  "box-shadow",
  "outline",
  "outline-color",
  "outline-offset",
  "outline-style",
  "outline-width",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "gap",
  "row-gap",
  "column-gap",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "display",
  "flex-basis",
  "flex-grow",
  "flex-shrink",
  "align-items",
  "align-self",
  "justify-content",
  "transform",
  "transform-origin",
  "filter",
  "backdrop-filter",
  "-webkit-backdrop-filter",
  "transition-duration",
  "transition-timing-function",
]);

/** Validates an unknown JSON value into a ControlsSpec. Any violation returns
 * null — malformed blocks are left in the message as plain text. */
export function validateControls(value: unknown): ControlsSpec | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;

  let title: string | undefined;
  if (obj.title !== undefined) {
    if (typeof obj.title !== "string" || obj.title.length > MAX_TITLE_LENGTH) {
      return null;
    }
    const trimmed = obj.title.trim();
    if (trimmed) title = trimmed;
  }

  let scope: ControlsScope | undefined;
  if (obj.scope !== undefined) {
    scope = validateControlsScope(obj.scope) ?? undefined;
    if (!scope) return null;
  }

  if (!Array.isArray(obj.controls)) return null;
  if (obj.controls.length < 1 || obj.controls.length > MAX_CONTROLS) return null;
  const controls: Control[] = [];
  const ids = new Set<string>();
  for (const entry of obj.controls) {
    const control = validateControl(entry);
    if (!control || ids.has(control.id)) return null;
    ids.add(control.id);
    controls.push(control);
  }

  if (!Array.isArray(obj.styles)) return null;
  if (obj.styles.length < 1 || obj.styles.length > MAX_STYLES) return null;
  const styles: StyleBinding[] = [];
  const referenced = new Set<string>();
  for (const entry of obj.styles) {
    const binding = validateBinding(entry, ids, referenced);
    if (!binding) return null;
    styles.push(binding);
  }
  // A control no template references is a malformed spec, not a harmless
  // extra — the agent misunderstood the format.
  for (const id of ids) {
    if (!referenced.has(id)) return null;
  }

  return {
    ...(title === undefined ? {} : { title }),
    ...(scope === undefined ? {} : { scope }),
    controls,
    styles,
  };
}

function validateControlsScope(value: unknown): ControlsScope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (obj.type === "element") return { type: "element" };
  if (obj.type !== "selector" || typeof obj.selector !== "string") return null;
  const selector = obj.selector.trim();
  if (
    !selector ||
    selector.length > MAX_SCOPE_SELECTOR_LENGTH ||
    !SCOPE_SELECTOR_RE.test(selector)
  ) {
    return null;
  }
  let label: string | undefined;
  if (obj.label !== undefined) {
    if (typeof obj.label !== "string") return null;
    const trimmed = obj.label.trim();
    if (!trimmed || trimmed.length > MAX_SCOPE_LABEL_LENGTH) return null;
    label = trimmed;
  }
  return label === undefined
    ? { type: "selector", selector }
    : { type: "selector", selector, label };
}

function validateControl(value: unknown): Control | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;

  if (typeof obj.id !== "string" || !ID_RE.test(obj.id)) return null;
  if (typeof obj.label !== "string") return null;
  const label = obj.label.trim();
  if (!label || label.length > MAX_LABEL_LENGTH) return null;

  switch (obj.type) {
    case "slider": {
      const { min, max, step, value: initial } = obj;
      if (typeof min !== "number" || !Number.isFinite(min)) return null;
      if (typeof max !== "number" || !Number.isFinite(max)) return null;
      if (min >= max) return null;
      let stepOut: number | undefined;
      if (step !== undefined) {
        if (typeof step !== "number" || !Number.isFinite(step) || step <= 0) {
          return null;
        }
        stepOut = step;
      }
      let unit: string | undefined;
      if (obj.unit !== undefined) {
        if (typeof obj.unit !== "string") return null;
        const trimmed = obj.unit.trim();
        if (trimmed) unit = trimmed;
      }
      if (typeof initial !== "number" || !Number.isFinite(initial)) return null;
      const clamped = Math.min(max, Math.max(min, initial));
      return {
        id: obj.id,
        type: "slider",
        label,
        min,
        max,
        ...(stepOut !== undefined ? { step: stepOut } : {}),
        ...(unit !== undefined ? { unit } : {}),
        value: clamped,
      };
    }
    case "color": {
      if (typeof obj.value !== "string") return null;
      const color = obj.value.trim();
      if (!color) return null;
      return { id: obj.id, type: "color", label, value: color };
    }
    case "select": {
      if (!Array.isArray(obj.options)) return null;
      const options: string[] = [];
      for (const opt of obj.options) {
        if (typeof opt !== "string") return null;
        const trimmed = opt.trim();
        if (!trimmed) return null;
        options.push(trimmed);
      }
      if (options.length < 2 || options.length > MAX_SELECT_OPTIONS) return null;
      if (typeof obj.value !== "string" || !options.includes(obj.value.trim())) {
        return null;
      }
      return {
        id: obj.id,
        type: "select",
        label,
        options,
        value: obj.value.trim(),
      };
    }
    default:
      return null;
  }
}

function validateBinding(
  value: unknown,
  ids: Set<string>,
  referenced: Set<string>,
): StyleBinding | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.property !== "string" || !PROPERTY_RE.test(obj.property)) {
    return null;
  }
  if (!ALLOWED_STYLE_PROPERTIES.has(obj.property)) return null;
  if (typeof obj.template !== "string") return null;
  const template = obj.template.trim();
  if (!template || template.length > MAX_TEMPLATE_LENGTH) return null;
  if (UNSAFE_CSS_VALUE_RE.test(template)) return null;

  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    const id = match[1] ?? "";
    if (!ids.has(id)) return null;
    referenced.add(id);
  }
  return { property: obj.property, template };
}

/** Initial values keyed by control id — the panel's starting state, seeded by
 * the agent from the element's computed styles. */
export function initialControlValues(spec: ControlsSpec): ControlValues {
  const values: ControlValues = {};
  for (const control of spec.controls) values[control.id] = control.value;
  return values;
}

/** Substitutes `{id}` placeholders in every binding template, producing a
 * CSS property → value map ready for inline-style preview or Apply. */
export function buildStyleMap(
  spec: ControlsSpec,
  values: ControlValues,
): Record<string, string> {
  const byId = new Map(spec.controls.map((c) => [c.id, c]));
  const styleMap: Record<string, string> = {};
  for (const binding of spec.styles) {
    const value = binding.template.replace(
      PLACEHOLDER_RE,
      (whole, id: string) => {
        const control = byId.get(id);
        if (!control) return whole;
        const raw = Object.prototype.hasOwnProperty.call(values, id)
          ? values[id]
          : undefined;
        return formatControlValue(control, raw);
      },
    );
    if (
      !UNSAFE_CSS_VALUE_RE.test(value) &&
      !UNSAFE_SUBSTITUTED_VALUE_RE.test(value)
    ) {
      styleMap[binding.property] = value;
    }
  }
  return styleMap;
}

function formatControlValue(
  control: Control,
  raw: string | number | undefined,
): string {
  if (control.type === "slider") {
    const num = typeof raw === "number" ? raw : Number(raw);
    const finite = Number.isFinite(num) ? num : control.value;
    // Runtime values come from UI inputs (or persisted state) — clamp into
    // the spec's range just like spec-time validation does.
    const value = Math.min(control.max, Math.max(control.min, finite));
    return `${value}${control.unit ?? ""}`;
  }
  const value = raw === undefined ? control.value : String(raw);
  return String(value);
}

/** The visible user message the Apply button sends into the chat. This is the
 * controls round-trip: the client composes it from the final style map and the
 * spec's scope and sends it as the next user turn. */
export function composeApplyMessage(
  styles: Record<string, string>,
  scope: ControlsScope = { type: "element" },
): string {
  const declarations = Object.entries(styles)
    .map(([property, value]) => `${property}: ${value}`)
    .join("\n");
  if (scope.type === "selector") {
    return (
      "Apply these style values from the tuning panel to every element matching the selector " +
      `\`${scope.selector}\`:\n` +
      "\n" +
      `${declarations}\n` +
      "\n" +
      "Implement them in this project's shared styling rule or component using its existing styling approach (Tailwind classes, CSS files, styled-components, etc.) — not inline styles. Keep the change minimal."
    );
  }
  return (
    "Apply these style values from the tuning panel to the element the controls were created for:\n" +
    "\n" +
    `${declarations}\n` +
    "\n" +
    "Implement them in this project's existing styling approach (Tailwind classes, CSS files, styled-components, etc.) — not inline styles. Keep the change minimal."
  );
}

/** Loose equality over value maps: `4` and `"4"` compare equal because range
 * inputs report strings while specs carry numbers. */
export function valuesEqual(
  a: ControlValues | undefined,
  b: ControlValues | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!(key in b)) return false;
    if (String(a[key]) !== String(b[key])) return false;
  }
  return true;
}

export interface ParsedControlsText {
  /** The message text with a valid controls block removed and trimmed. Empty
   * string when the message was nothing but the block. */
  text: string;
  /** The parsed spec, or null when the message had no valid block. */
  controls: ControlsSpec | null;
}

/** Matches the first controls fenced block. The info string must be exactly
 * the block name (optionally followed by trailing spaces) so plain ```json
 * blocks the agent emits for other reasons are ignored. */
const BLOCK_RE =
  /```(?:agent-controls|carve-controls)[^\S\r\n]*\r?\n([\s\S]*?)\r?\n?```/;

export function parseControlsBlock(raw: string): ParsedControlsText {
  const match = BLOCK_RE.exec(raw);
  if (!match) return { text: raw, controls: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse((match[1] ?? "").trim());
  } catch {
    return { text: raw, controls: null };
  }
  const controls = validateControls(parsed);
  if (!controls) return { text: raw, controls: null };

  // Removing the block from the middle of a message leaves the blank lines
  // that bracketed it stacked together — collapse those so the prose reads
  // naturally either side of the seam.
  const text = (raw.slice(0, match.index) + raw.slice(match.index + match[0].length))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, controls };
}
