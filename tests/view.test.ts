import { describe, expect, it } from "vitest";
import {
  VIEW_CATALOG,
  VIEW_PROMPT,
  parseViewBlock,
  validateViewSpec,
  type ViewComponent,
} from "../src/index";

/** Builds a spec from loose component objects, as SSE decoding would see it. */
const spec = (...components: unknown[]): unknown => ({ components });

const stack = (id: string, children: string[]): unknown => ({
  id,
  type: "Stack",
  children,
});

const text = (id: string, value: string): unknown => ({ id, type: "Text", value });

describe("component schemas", () => {
  /** The component as it survives validation, or undefined when it was
   * skipped — the view itself still validates around a bad component. */
  const ok = (component: unknown): ViewComponent | undefined => {
    const target = (component as { id: string }).id;
    return validateViewSpec(spec(stack("root", [target]), component))
      ?.components.find((c) => c.id === target);
  };

  it("accepts one representative component per tier", () => {
    expect(ok({ id: "h", type: "Heading", level: 2, text: "Revenue" })).toBeDefined();
    expect(ok({ id: "s", type: "Stat", label: "MRR", value: "$12k", trend: "up", spark: [1, 2, 3] })).toBeDefined();
    expect(ok({
      id: "t",
      type: "Table",
      columns: [{ key: "name", label: "Name" }, { key: "n", label: "Count", align: "right", format: "number" }],
      rows: [{ name: "a", n: 1 }],
    })).toBeDefined();
    expect(ok({
      id: "c",
      type: "Chart",
      kind: "line",
      series: [{ label: "req/s", points: [{ x: "Mon", y: 4 }] }],
    })).toBeDefined();
    expect(ok({ id: "d", type: "Diff", value: "--- a\n+++ b\n-old\n+new" })).toBeDefined();
    expect(ok({ id: "tl", type: "Timeline", items: [{ label: "Deploy", status: "done" }] })).toBeDefined();
    expect(ok({ id: "i", type: "Input", bind: "$region", label: "Region" })).toBeDefined();
    expect(ok({ id: "b", type: "Button", label: "Rerun", message: "Rerun for {$region}" })).toBeDefined();
  });

  it("rejects out-of-vocabulary values", () => {
    expect(ok({ id: "h", type: "Heading", level: 7, text: "x" })).toBeUndefined();
    expect(ok({ id: "b", type: "Badge", label: "x", variant: "sparkly" })).toBeUndefined();
    expect(ok({ id: "c", type: "Chart", kind: "treemap", series: [] })).toBeUndefined();
    expect(ok({ id: "x", type: "Iframe", src: "https://x" })).toBeUndefined();
  });

  it("requires bind vars to look like $identifiers", () => {
    expect(ok({ id: "i", type: "Input", bind: "region", label: "x" })).toBeUndefined();
    expect(ok({ id: "i", type: "Input", bind: "$1bad", label: "x" })).toBeUndefined();
  });

  it("requires a Button to have exactly one of message or href", () => {
    expect(ok({ id: "b", type: "Button", label: "x" })).toBeUndefined();
    expect(ok({ id: "b", type: "Button", label: "x", message: "m", href: "https://x" })).toBeUndefined();
    expect(ok({ id: "b", type: "Button", label: "x", href: "https://example.com" })).toBeDefined();
  });

  it("ignores unknown props instead of rejecting the component", () => {
    const heading = ok({ id: "h", type: "Heading", level: 1, text: "x", glitter: true });
    expect(heading).toBeDefined();
    expect(heading).not.toHaveProperty("glitter");
  });
});

describe("validateViewSpec graph rules", () => {
  it("requires a component with id root", () => {
    expect(validateViewSpec(spec(stack("main", ["t"]), text("t", "x")))).toBeNull();
  });

  it("keeps the first component when ids collide", () => {
    const view = validateViewSpec(spec(
      stack("root", ["t"]),
      text("t", "first"),
      text("t", "second"),
    ));
    expect(view?.components.find((c) => c.id === "t")).toMatchObject({ value: "first" });
  });

  it("prunes dangling child references", () => {
    const view = validateViewSpec(spec(stack("root", ["t", "ghost"]), text("t", "x")));
    const root = view?.components.find((c) => c.id === "root");
    expect(root).toMatchObject({ children: ["t"] });
  });

  it("renders each component once, pruning repeat and cyclic references", () => {
    const view = validateViewSpec(spec(
      stack("root", ["a", "a", "b"]),
      stack("a", ["root"]),
      text("b", "x"),
    ));
    expect(view?.components.find((c) => c.id === "root")).toMatchObject({ children: ["a", "b"] });
    expect(view?.components.find((c) => c.id === "a")).toMatchObject({ children: [] });
  });

  it("drops components unreachable from root", () => {
    const view = validateViewSpec(spec(stack("root", ["t"]), text("t", "x"), text("orphan", "y")));
    expect(view?.components.map((c) => c.id)).toEqual(["root", "t"]);
  });

  it("collects children from Tabs items", () => {
    const view = validateViewSpec(spec(
      { id: "root", type: "Tabs", items: [{ label: "A", children: ["t"] }, { label: "B", children: ["ghost"] }] },
      text("t", "x"),
    ));
    expect(view?.components.map((c) => c.id)).toEqual(["root", "t"]);
    expect(view?.components[0]).toMatchObject({
      items: [{ label: "A", children: ["t"] }, { label: "B", children: [] }],
    });
  });

  it("enforces the component cap by pruning the excess", () => {
    // 12 stacks × 12 texts (157 total, depth 3) — wide enough to pass the
    // per-container children cap while overflowing the whole-view cap.
    const groups = Array.from({ length: 12 }, (_, g) => `g${g}`);
    const components = groups.flatMap((g) => {
      const leaves = Array.from({ length: 12 }, (_, i) => `${g}t${i}`);
      return [stack(g, leaves), ...leaves.map((id) => text(id, "x"))];
    });
    const view = validateViewSpec(spec(stack("root", groups), ...components));
    expect(view?.components.length).toBe(100);
  });
});

describe("parseViewBlock", () => {
  const block = (...lines: string[]): string =>
    ["```agent-view", ...lines, "```"].join("\n");

  it("extracts a view and strips the block from the prose", () => {
    const raw = `Here is the report.\n\n${block(
      JSON.stringify(stack("root", ["t"])),
      JSON.stringify(text("t", "All systems nominal.")),
    )}`;
    const parsed = parseViewBlock(raw);
    expect(parsed.text).toBe("Here is the report.");
    expect(parsed.view?.components.map((c) => c.id)).toEqual(["root", "t"]);
  });

  it("skips malformed and invalid lines but keeps the view", () => {
    const parsed = parseViewBlock(block(
      JSON.stringify(stack("root", ["t", "bad"])),
      "{not json",
      JSON.stringify({ id: "bad", type: "Hologram" }),
      "",
      JSON.stringify(text("t", "x")),
    ));
    expect(parsed.view?.components.map((c) => c.id)).toEqual(["root", "t"]);
  });

  it("leaves the block as prose when no valid root exists", () => {
    const raw = block(JSON.stringify(text("t", "x")));
    const parsed = parseViewBlock(raw);
    expect(parsed.view).toBeNull();
    expect(parsed.text).toBe(raw);
  });

  it("bounds validation work on oversized component arrays", () => {
    // Entries past the input ceiling are never validated — a hostile frame
    // cannot buy unbounded safeParse work, and late definitions are pruned.
    const filler = Array.from({ length: 500 }, (_, i) => text(`f${i}`, "x"));
    const view = validateViewSpec(spec(stack("root", ["late"]), ...filler, text("late", "x")));
    expect(view?.components.map((c) => c.id)).toEqual(["root"]);
  });

  it("measures the block ceiling in bytes, not UTF-16 units", () => {
    const multibyte = block(
      JSON.stringify(stack("root", ["t"])),
      JSON.stringify(text("t", "€".repeat(30_000))),
    );
    expect(multibyte.length).toBeLessThan(65_536);
    expect(parseViewBlock(multibyte).view).toBeNull();
  });

  it("leaves an oversized block as prose", () => {
    const big = block(
      JSON.stringify(stack("root", ["t"])),
      JSON.stringify(text("t", "x".repeat(70_000))),
    );
    expect(parseViewBlock(big).view).toBeNull();
  });

  it("ignores ordinary fenced blocks", () => {
    const raw = "Look:\n\n```json\n{\"id\":\"root\"}\n```";
    const parsed = parseViewBlock(raw);
    expect(parsed.view).toBeNull();
    expect(parsed.text).toBe(raw);
  });
});

describe("VIEW_PROMPT", () => {
  it("teaches every catalog component, so prompt and validator cannot drift", () => {
    for (const name of Object.keys(VIEW_CATALOG)) {
      expect(VIEW_PROMPT).toContain(name);
    }
  });

  it("states the load-bearing rules", () => {
    expect(VIEW_PROMPT).toContain("agent-view");
    expect(VIEW_PROMPT).toContain('"root"');
    expect(VIEW_PROMPT).toContain("one JSON object per line");
  });
});
