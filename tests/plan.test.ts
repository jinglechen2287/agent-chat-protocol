import { describe, expect, it } from "vitest";
import { CHAT_PROMPT, parseProposedPlan, PLAN_PROMPT } from "../src/index";

const wrap = (body: string): string =>
  "<proposed_plan>\n" + body + "\n</proposed_plan>";

const PLAN_BODY = [
  "# Add subtract to a.ts",
  "",
  "## Summary",
  "Mirror the existing add export.",
  "",
  "```ts",
  "export const subtract = (a, b) => a - b;",
  "```",
].join("\n");

describe("parseProposedPlan", () => {
  it("lifts a valid proposed_plan block and strips it from the prose", () => {
    const raw = "Here is the plan.\n\n" + wrap(PLAN_BODY);
    const parsed = parseProposedPlan(raw);
    expect(parsed.plan).toEqual({
      planMarkdown: PLAN_BODY,
      title: "Add subtract to a.ts",
    });
    expect(parsed.text).toBe("Here is the plan.");
  });

  it("returns an empty text when the message is only the block", () => {
    const parsed = parseProposedPlan(wrap(PLAN_BODY));
    expect(parsed.plan?.planMarkdown).toBe(PLAN_BODY);
    expect(parsed.text).toBe("");
  });

  it("survives code fences inside the plan body", () => {
    const parsed = parseProposedPlan(wrap(PLAN_BODY));
    expect(parsed.plan?.planMarkdown).toContain("```ts");
  });

  it("collapses the blank-line seam left mid-message", () => {
    const raw = "Before.\n\n" + wrap(PLAN_BODY) + "\n\nAfter.";
    const parsed = parseProposedPlan(raw);
    expect(parsed.text).toBe("Before.\n\nAfter.");
  });

  it("uses the first markdown heading as the title", () => {
    const parsed = parseProposedPlan(wrap("Intro line.\n\n## The real title\n\nBody."));
    expect(parsed.plan?.title).toBe("The real title");
  });

  it("reports a null title when the plan has no heading", () => {
    const parsed = parseProposedPlan(wrap("Just prose, no heading."));
    expect(parsed.plan?.title).toBeNull();
  });

  it("skips heading-like comment lines inside fenced code blocks", () => {
    const body = [
      "Intro paragraph.",
      "",
      "```sh",
      "# install deps",
      "npm i",
      "```",
      "",
      "# Real Title",
      "",
      "Body.",
    ].join("\n");
    const parsed = parseProposedPlan(wrap(body));
    expect(parsed.plan?.title).toBe("Real Title");
  });

  it("reports a null title when the only heading-like lines sit inside fences", () => {
    const body = ["~~~", "# just a comment", "~~~", "", "Prose only."].join("\n");
    const parsed = parseProposedPlan(wrap(body));
    expect(parsed.plan).not.toBeNull();
    expect(parsed.plan?.title).toBeNull();
  });

  it("does not open a fence for a backtick marker with backticks in its info string", () => {
    const body = ["``` `inline code` ```", "# Real Title"].join("\n");
    const parsed = parseProposedPlan(wrap(body));
    expect(parsed.plan?.title).toBe("Real Title");
  });

  it("strips a closing ATX sequence but preserves hashes that are part of the title", () => {
    expect(parseProposedPlan(wrap("# Title ###")).plan?.title).toBe("Title");
    expect(parseProposedPlan(wrap("# Title#")).plan?.title).toBe("Title#");
    expect(parseProposedPlan(wrap("# Title ### b")).plan?.title).toBe("Title ### b");
  });

  it("skips empty ATX headings instead of returning their hash runs", () => {
    expect(parseProposedPlan(wrap("### ###")).plan?.title).toBeNull();
    expect(parseProposedPlan(wrap("# #")).plan?.title).toBeNull();
    expect(parseProposedPlan(wrap(["##", "", "# Later"].join("\n"))).plan?.title).toBe("Later");
  });

  it("treats tab-indented markers and headings as ordinary text", () => {
    const body = ["Intro.", "\t# tab heading", "\t```", "# Real Title"].join("\n");
    expect(parseProposedPlan(wrap(body)).plan?.title).toBe("Real Title");
  });

  it("does not let a matching marker followed by text close an open fence", () => {
    const body = [
      "```",
      "``` not a closing fence",
      "# still fenced",
      "```",
      "",
      "# After the fence",
    ].join("\n");
    const parsed = parseProposedPlan(wrap(body));
    expect(parsed.plan?.title).toBe("After the fence");
  });

  it("does not let a shorter or mismatched marker close an open fence", () => {
    const body = [
      "````",
      "```",
      "# still fenced",
      "~~~",
      "# also still fenced",
      "````",
      "",
      "## After the fence",
    ].join("\n");
    const parsed = parseProposedPlan(wrap(body));
    expect(parsed.plan?.title).toBe("After the fence");
  });

  it("tolerates whitespace around the tag lines and CRLF", () => {
    const raw = "  <proposed_plan>  \r\n# T\r\nBody.\r\n  </proposed_plan>  ";
    const parsed = parseProposedPlan(raw);
    expect(parsed.plan).toEqual({ planMarkdown: "# T\nBody.", title: "T" });
  });

  it("ignores tags that are not on their own line", () => {
    const raw = "Inline <proposed_plan> not a block </proposed_plan> mention.";
    const parsed = parseProposedPlan(raw);
    expect(parsed.plan).toBeNull();
    expect(parsed.text).toBe(raw);
  });

  it("leaves an unclosed block in place as plain text", () => {
    const raw = "<proposed_plan>\n# T\nNever closed.";
    const parsed = parseProposedPlan(raw);
    expect(parsed.plan).toBeNull();
    expect(parsed.text).toBe(raw);
  });

  it("rejects an empty plan body", () => {
    const parsed = parseProposedPlan("<proposed_plan>\n   \n</proposed_plan>");
    expect(parsed.plan).toBeNull();
  });

  it("rejects a plan over the length ceiling", () => {
    const parsed = parseProposedPlan(wrap("# T\n" + "x".repeat(120_000)));
    expect(parsed.plan).toBeNull();
  });

  it("lifts only the first block; later ones stay as text", () => {
    const raw = wrap("# First") + "\n\n" + wrap("# Second");
    const parsed = parseProposedPlan(raw);
    expect(parsed.plan?.title).toBe("First");
    expect(parsed.text).toContain("# Second");
  });
});

describe("PLAN_PROMPT", () => {
  it("teaches the proposed_plan tags and forbids ExitPlanMode", () => {
    expect(PLAN_PROMPT).toContain("<proposed_plan>");
    expect(PLAN_PROMPT).toContain("</proposed_plan>");
    expect(PLAN_PROMPT).toContain("ExitPlanMode");
  });
});

describe("CHAT_PROMPT", () => {
  it("frames the read-only answering turn without teaching the plan block", () => {
    expect(CHAT_PROMPT).toContain("Chat mode");
    expect(CHAT_PROMPT).toContain("it does not produce a plan");
    expect(CHAT_PROMPT).not.toMatch(/<\/?proposed_plan\b[^>]*>/i);
  });

  it("forbids every mutation channel, including external tools", () => {
    expect(CHAT_PROMPT).toMatch(/Not allowed:.*editing or writing files/s);
    expect(CHAT_PROMPT).toMatch(/mutat\w+ through (external|MCP)/i);
  });
});
