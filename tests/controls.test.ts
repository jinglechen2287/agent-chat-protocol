import { describe, expect, it } from "vitest";
import {
  buildStyleMap,
  composeApplyMessage,
  initialControlValues,
  parseControlsBlock,
  validateControls,
  valuesEqual,
  type ControlsSpec,
} from "../src/index";

const validSpec = (): Record<string, unknown> => ({
  title: "Card shadow",
  scope: { type: "element" },
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
  styles: [
    { property: "box-shadow", template: "0px {y} 12px 0px {shadowColor}" },
    { property: "font-weight", template: "{weight}" },
  ],
});

describe("validateControls", () => {
  it("accepts a full spec with element scope", () => {
    const spec = validateControls(validSpec());
    expect(spec).not.toBeNull();
    expect(spec?.title).toBe("Card shadow");
    expect(spec?.scope).toEqual({ type: "element" });
    expect(spec?.controls).toHaveLength(3);
  });

  it("accepts a selector scope with an optional label", () => {
    const raw = validSpec();
    raw.scope = { type: "selector", selector: "img.project-images", label: "All images" };
    const spec = validateControls(raw);
    expect(spec?.scope).toEqual({
      type: "selector",
      selector: "img.project-images",
      label: "All images",
    });
  });

  it("treats a missing scope as valid (legacy specs)", () => {
    const raw = validSpec();
    delete raw.scope;
    const spec = validateControls(raw);
    expect(spec).not.toBeNull();
    expect(spec?.scope).toBeUndefined();
  });

  it.each([
    ["tag only", "img"],
    ["combinator", ".a > .b"],
    ["selector list", ".a, .b"],
    ["attribute", "a[href]"],
    ["pseudo-class", ".a:hover"],
  ])("rejects a %s scope selector", (_name, selector) => {
    const raw = validSpec();
    raw.scope = { type: "selector", selector };
    expect(validateControls(raw)).toBeNull();
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

  it("rejects a control referenced by no style template", () => {
    const raw = validSpec();
    raw.styles = [{ property: "font-weight", template: "{weight}" }];
    expect(validateControls(raw)).toBeNull();
  });

  it("rejects templates referencing unknown ids", () => {
    const raw = validSpec();
    raw.styles = [
      { property: "box-shadow", template: "0px {y} 12px 0px {shadowColor}" },
      { property: "font-weight", template: "{nope}" },
    ];
    expect(validateControls(raw)).toBeNull();
  });

  it("rejects disallowed CSS properties", () => {
    const raw = validSpec();
    raw.styles = [
      { property: "box-shadow", template: "0px {y} 12px 0px {shadowColor}" },
      { property: "font-weight", template: "{weight}" },
      { property: "position", template: "{weight}" },
    ];
    expect(validateControls(raw)).toBeNull();
  });

  it.each([
    ["url()", "url(http://x.test) {y}"],
    ["expression()", "expression({y})"],
    ["@import", "@import {y}"],
    ["comment", "/* {y} */"],
    ["backslash", "\\75rl {y}"],
  ])("rejects unsafe template syntax: %s", (_name, template) => {
    const raw = validSpec();
    raw.styles = [
      { property: "box-shadow", template },
      { property: "font-weight", template: "{weight}" },
      { property: "border-color", template: "{shadowColor}" },
    ];
    expect(validateControls(raw)).toBeNull();
  });

  it("rejects a select whose value is not among its options", () => {
    const raw = validSpec();
    (raw.controls as Record<string, unknown>[])[2]!.value = "700";
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
    big.styles = [
      {
        property: "opacity",
        template: Array.from({ length: 13 }, (_, i) => `{c${i}}`).join(" "),
      },
    ];
    expect(validateControls(big)).toBeNull();
  });
});

describe("style substitution", () => {
  it("seeds initial values from the spec", () => {
    const spec = validateControls(validSpec())!;
    expect(initialControlValues(spec)).toEqual({
      y: 4,
      shadowColor: "#1f293733",
      weight: "600",
    });
  });

  it("substitutes placeholders and appends slider units", () => {
    const spec = validateControls(validSpec())!;
    const styles = buildStyleMap(spec, {
      y: 8,
      shadowColor: "#000000",
      weight: "400",
    });
    expect(styles).toEqual({
      "box-shadow": "0px 8px 12px 0px #000000",
      "font-weight": "400",
    });
  });

  it("coerces string slider values from range inputs", () => {
    const spec = validateControls(validSpec())!;
    const styles = buildStyleMap(spec, {
      y: "10",
      shadowColor: "#000000",
      weight: "400",
    });
    expect(styles["box-shadow"]).toBe("0px 10px 12px 0px #000000");
  });

  it("drops a substituted value that becomes unsafe", () => {
    const spec = validateControls(validSpec())!;
    const styles = buildStyleMap(spec, {
      y: 8,
      shadowColor: "url(http://evil.test)",
      weight: "400",
    });
    expect(styles["box-shadow"]).toBeUndefined();
    expect(styles["font-weight"]).toBe("400");
  });
});

describe("composeApplyMessage", () => {
  it("targets the picked element by default", () => {
    const message = composeApplyMessage({ "border-radius": "8px" });
    expect(message).toContain("the element the controls were created for");
    expect(message).toContain("border-radius: 8px");
  });

  it("targets every match for a selector scope", () => {
    const message = composeApplyMessage(
      { "border-radius": "8px" },
      { type: "selector", selector: "img.card" },
    );
    expect(message).toContain("every element matching the selector `img.card`");
  });
});

describe("valuesEqual", () => {
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
    styles: [{ property: "border-radius", template: "{r}" }],
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
});

describe("ControlsSpec type", () => {
  it("round-trips through validation unchanged when already canonical", () => {
    const spec: ControlsSpec = {
      controls: [
        { id: "r", type: "slider", label: "Radius", min: 0, max: 32, value: 8 },
      ],
      styles: [{ property: "border-radius", template: "{r}" }],
    };
    expect(validateControls(spec)).toEqual(spec);
  });
});
