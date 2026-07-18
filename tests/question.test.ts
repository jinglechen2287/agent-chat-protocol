import { describe, expect, it } from "vitest";
import { parseQuestionBlock } from "../src/index";

const block = (name: string, body: string): string =>
  "```" + name + "\n" + body + "\n```";

describe("parseQuestionBlock", () => {
  it("lifts a valid agent-question block and strips it from the prose", () => {
    const raw =
      "I can do this two ways.\n\n" +
      block(
        "agent-question",
        '{"question": "Which nav style?", "options": ["Sidebar", "Top bar"]}',
      );
    const parsed = parseQuestionBlock(raw);
    expect(parsed.question).toEqual({
      question: "Which nav style?",
      options: ["Sidebar", "Top bar"],
    });
    expect(parsed.text).toBe("I can do this two ways.");
  });

  it("accepts the legacy carve-question fence during migration", () => {
    const raw = block(
      "carve-question",
      '{"question": "Which?", "options": ["A", "B"]}',
    );
    const parsed = parseQuestionBlock(raw);
    expect(parsed.question).toEqual({ question: "Which?", options: ["A", "B"] });
    expect(parsed.text).toBe("");
  });

  it("ignores plain json fences", () => {
    const raw = block("json", '{"question": "Which?", "options": ["A", "B"]}');
    const parsed = parseQuestionBlock(raw);
    expect(parsed.question).toBeNull();
    expect(parsed.text).toBe(raw);
  });

  it("leaves malformed JSON in place as plain text", () => {
    const raw = block("agent-question", "{not json");
    const parsed = parseQuestionBlock(raw);
    expect(parsed.question).toBeNull();
    expect(parsed.text).toBe(raw);
  });

  it("requires at least two options", () => {
    const raw = block("agent-question", '{"question": "Q?", "options": ["Only"]}');
    expect(parseQuestionBlock(raw).question).toBeNull();
  });

  it("skips blank and non-string options and caps at eight", () => {
    const options = JSON.stringify([
      "A",
      " ",
      3,
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
    ]);
    const raw = block(
      "agent-question",
      `{"question": "Q?", "options": ${options}}`,
    );
    const parsed = parseQuestionBlock(raw);
    expect(parsed.question?.options).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
    ]);
  });

  it("deduplicates options so repeats can't satisfy the two-choice minimum", () => {
    const raw = block(
      "agent-question",
      '{"question": "Q?", "options": ["A", "A", " A "]}',
    );
    expect(parseQuestionBlock(raw).question).toBeNull();

    const dedupe = block(
      "agent-question",
      '{"question": "Q?", "options": ["A", "A", "B"]}',
    );
    expect(parseQuestionBlock(dedupe).question?.options).toEqual(["A", "B"]);
  });

  it("rejects over-length questions and skips over-length options", () => {
    const longQuestion = block(
      "agent-question",
      JSON.stringify({ question: "Q".repeat(501), options: ["A", "B"] }),
    );
    expect(parseQuestionBlock(longQuestion).question).toBeNull();

    const longOption = block(
      "agent-question",
      JSON.stringify({ question: "Q?", options: ["A", "B", "C".repeat(101)] }),
    );
    expect(parseQuestionBlock(longOption).question?.options).toEqual(["A", "B"]);
  });

  it("collapses the blank-line seam when the block sat mid-message", () => {
    const raw =
      "Before.\n\n" +
      block("agent-question", '{"question": "Q?", "options": ["A", "B"]}') +
      "\n\nAfter.";
    const parsed = parseQuestionBlock(raw);
    expect(parsed.text).toBe("Before.\n\nAfter.");
  });
});
