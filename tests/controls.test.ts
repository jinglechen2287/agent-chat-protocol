import { describe, expect, it } from "vitest";
import {
  initialControlValues,
  parseControlsBlock,
  validateControls,
  valuesEqual,
  type ControlsSpec,
} from "../src/index";

const validSpec = (): Record<string, unknown> => ({
  title: "Card shadow",
  controls: [
    {
      id: "y",
      type: "slider",
      label: "Offset Y",
      min: -20,
      max: 40,
      step: 1,
      unit: "px",
      value: 4,
    },
    { id: "shadowColor", type: "color", label: "Shadow color", value: "#1f293733" },
    {
      id: "weight",
      type: "select",
      label: "Font weight",
      options: ["400", "600"],
      value: "600",
    },
  ],
});

describe("validateControls", () => {
  it("accepts a core spec with all three widget types", () => {
    const spec = validateControls(validSpec());
    expect(spec).not.toBeNull();
    expect(spec?.title).toBe("Card shadow");
    expect(spec?.controls).toHaveLength(3);
  });

  it("ignores unknown extension fields without rejecting or copying them", () => {
    const raw = validSpec();
    raw.scope = { type: "element" };
    raw.styles = [{ property: "box-shadow", template: "0px {y}" }];
    const spec = validateControls(raw);
    expect(spec).not.toBeNull();
    expect(spec).toEqual({
      title: "Card shadow",
      controls: validateControls(validSpec())!.controls,
    });
    expect("styles" in (spec as object)).toBe(false);
    expect("scope" in (spec as object)).toBe(false);
  });

  it("clamps slider values into range", () => {
    const raw = validSpec();
    (raw.controls as Record<string, unknown>[])[0]!.value = 999;
    const spec = validateControls(raw);
    expect((spec?.controls[0] as { value: number }).value).toBe(40);
  });

  it("rejects duplicate control ids", () => {
    const raw = validSpec();
    (raw.controls as Record<string, unknown>[])[1]!.id = "y";
    expect(validateControls(raw)).toBeNull();
  });

  it("rejects a select whose value is not among its options", () => {
    const raw = validSpec();
    (raw.controls as Record<string, unknown>[])[2]!.value = "700";
    expect(validateControls(raw)).toBeNull();
  });

  it("rejects a slider whose min is not below max", () => {
    const raw = validSpec();
    (raw.controls as Record<string, unknown>[])[0]!.min = 40;
    expect(validateControls(raw)).toBeNull();
  });

  it("rejects an over-length title", () => {
    const raw = validSpec();
    raw.title = "T".repeat(61);
    expect(validateControls(raw)).toBeNull();
  });

  it("rejects empty and oversized control lists", () => {
    const raw = validSpec();
    raw.controls = [];
    expect(validateControls(raw)).toBeNull();

    const big = validSpec();
    big.controls = Array.from({ length: 13 }, (_, i) => ({
      id: `c${i}`,
      type: "slider",
      label: `C${i}`,
      min: 0,
      max: 1,
      value: 0,
    }));
    expect(validateControls(big)).toBeNull();
  });
});

describe("values helpers", () => {
  it("seeds initial values from the spec", () => {
    const spec = validateControls(validSpec())!;
    expect(initialControlValues(spec)).toEqual({
      y: 4,
      shadowColor: "#1f293733",
      weight: "600",
    });
  });

  it("compares loosely across string/number", () => {
    expect(valuesEqual({ a: 4 }, { a: "4" })).toBe(true);
    expect(valuesEqual({ a: 4 }, { a: 5 })).toBe(false);
    expect(valuesEqual({ a: 4 }, { a: 4, b: 1 })).toBe(false);
    expect(valuesEqual(undefined, undefined)).toBe(true);
    expect(valuesEqual({ a: 4 }, undefined)).toBe(false);
  });
});

describe("parseControlsBlock", () => {
  const body = JSON.stringify({
    controls: [
      { id: "r", type: "slider", label: "Radius", min: 0, max: 32, value: 8 },
    ],
  });

  it("lifts a valid agent-controls block and strips it", () => {
    const raw = "Tune it live:\n\n```agent-controls\n" + body + "\n```";
    const parsed = parseControlsBlock(raw);
    expect(parsed.controls?.controls[0]?.id).toBe("r");
    expect(parsed.text).toBe("Tune it live:");
  });

  it("accepts the legacy carve-controls fence during migration", () => {
    const raw = "```carve-controls\n" + body + "\n```";
    const parsed = parseControlsBlock(raw);
    expect(parsed.controls).not.toBeNull();
    expect(parsed.text).toBe("");
  });

  it("leaves invalid specs in place as plain text", () => {
    const raw = "```agent-controls\n{\"controls\": []}\n```";
    const parsed = parseControlsBlock(raw);
    expect(parsed.controls).toBeNull();
    expect(parsed.text).toBe(raw);
  });

  it("leaves the block as plain text when a custom validator rejects it", () => {
    const raw = "```agent-controls\n" + body + "\n```";
    const parsed = parseControlsBlock(raw, () => null);
    expect(parsed.controls).toBeNull();
    expect(parsed.text).toBe(raw);
  });

  it("lets a custom validator lift an extended spec", () => {
    interface ExtendedSpec extends ControlsSpec {
      styles: unknown[];
    }
    const extendedBody = JSON.stringify({
      controls: [
        { id: "r", type: "slider", label: "Radius", min: 0, max: 32, value: 8 },
      ],
      styles: [{ property: "border-radius", template: "{r}" }],
    });
    const raw = "```agent-controls\n" + extendedBody + "\n```";
    const parsed = parseControlsBlock<ExtendedSpec>(raw, (value) => {
      const core = validateControls(value);
      if (!core) return null;
      const styles = (value as Record<string, unknown>).styles;
      if (!Array.isArray(styles)) return null;
      return { ...core, styles };
    });
    expect(parsed.controls?.styles).toEqual([
      { property: "border-radius", template: "{r}" },
    ]);
    expect(parsed.text).toBe("");
  });
});

describe("ControlsSpec type", () => {
  it("round-trips through validation unchanged when already canonical", () => {
    const spec: ControlsSpec = {
      controls: [
        { id: "r", type: "slider", label: "Radius", min: 0, max: 32, value: 8 },
      ],
    };
    expect(validateControls(spec)).toEqual(spec);
  });
});
