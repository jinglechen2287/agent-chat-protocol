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

export interface SliderControl {
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

export interface ControlsSpec {
  title?: string;
  controls: Control[];
}

/** Current values keyed by control id. Range/text inputs report strings, so
 * both are allowed; comparison and app-side consumption coerce as needed. */
export type ControlValues = Record<string, string | number>;

/** Defensive ceilings — the agent is asked for less; a runaway block should
 * degrade to plain text rather than flood the client. */
const MAX_CONTROLS = 12;
const MAX_SELECT_OPTIONS = 12;
const MAX_LABEL_LENGTH = 40;
const MAX_TITLE_LENGTH = 60;

const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/**
 * Validates an unknown JSON value into the core ControlsSpec. Any violation
 * returns null — malformed blocks are left in the message as plain text.
 * Unknown fields (app extensions) are ignored, not rejected: extension
 * validation belongs to the app validator layered on top.
 */
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

  return {
    ...(title === undefined ? {} : { title }),
    controls,
  };
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

/** Initial values keyed by control id — the panel's starting state. */
export function initialControlValues(spec: ControlsSpec): ControlValues {
  const values: ControlValues = {};
  for (const control of spec.controls) values[control.id] = control.value;
  return values;
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

export interface ParsedControlsText<TSpec extends ControlsSpec = ControlsSpec> {
  /** The message text with a valid controls block removed and trimmed. Empty
   * string when the message was nothing but the block. */
  text: string;
  /** The parsed spec, or null when the message had no valid block. */
  controls: TSpec | null;
}

/** Matches the first controls fenced block. The info string must be exactly
 * the block name (optionally followed by trailing spaces) so plain ```json
 * blocks the agent emits for other reasons are ignored. */
const BLOCK_RE =
  /```(?:agent-controls|carve-controls)[^\S\r\n]*\r?\n([\s\S]*?)\r?\n?```/;

/**
 * Extracts the first controls block. `validate` defaults to the core
 * validator; apps with extensions pass their own (e.g. carve's CSS-binding
 * validator) — when it rejects, the block is left in the prose as plain text,
 * exactly like a malformed block. The overloads keep the narrowed spec type
 * tied to the presence of a custom validator.
 */
export function parseControlsBlock(raw: string): ParsedControlsText;
export function parseControlsBlock<TSpec extends ControlsSpec>(
  raw: string,
  validate: (value: unknown) => TSpec | null,
): ParsedControlsText<TSpec>;
export function parseControlsBlock<TSpec extends ControlsSpec = ControlsSpec>(
  raw: string,
  validate: (value: unknown) => TSpec | null = validateControls as (
    value: unknown,
  ) => TSpec | null,
): ParsedControlsText<TSpec> {
  const match = BLOCK_RE.exec(raw);
  if (!match) return { text: raw, controls: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse((match[1] ?? "").trim());
  } catch {
    return { text: raw, controls: null };
  }
  const controls = validate(parsed);
  if (!controls) return { text: raw, controls: null };

  // Removing the block from the middle of a message leaves the blank lines
  // that bracketed it stacked together — collapse those so the prose reads
  // naturally either side of the seam.
  const text = (raw.slice(0, match.index) + raw.slice(match.index + match[0].length))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, controls };
}
