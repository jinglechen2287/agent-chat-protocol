import { describe, expect, it } from "vitest";
import { formatQuestionAnswers, parseQuestionBlock } from "../src/index";

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

  it("takes a single option, so an agent can offer one next step", () => {
    const raw = block("agent-question", '{"question": "Q?", "options": ["Only"]}');
    expect(parseQuestionBlock(raw).question).toEqual({ question: "Q?", options: ["Only"] });
  });

  it("requires at least one option", () => {
    for (const options of ["[]", '[" "]', "[3]"]) {
      const raw = block("agent-question", `{"question": "Q?", "options": ${options}}`);
      expect(parseQuestionBlock(raw).question).toBeNull();
      expect(parseQuestionBlock(raw).text).toBe(raw);
    }
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

  it("deduplicates options", () => {
    const raw = block(
      "agent-question",
      '{"question": "Q?", "options": ["A", "A", " A "]}',
    );
    expect(parseQuestionBlock(raw).question?.options).toEqual(["A"]);

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

  it("lifts a list of questions into a form, the first mirrored on top", () => {
    const raw = block(
      "agent-question",
      JSON.stringify({
        questions: [
          { question: "Where?", options: ["Settings", "Own page"] },
          { question: "Split by?", options: ["Machine", "Model"], multi: true },
        ],
      }),
    );
    expect(parseQuestionBlock(raw).question).toEqual({
      question: "Where?",
      options: ["Settings", "Own page"],
      questions: [
        { question: "Where?", options: ["Settings", "Own page"] },
        { question: "Split by?", options: ["Machine", "Model"], multi: true },
      ],
    });
  });

  it("makes a single multi-select question a form", () => {
    const raw = block("agent-question", '{"question": "Which?", "options": ["A", "B"], "multi": true}');
    expect(parseQuestionBlock(raw).question).toEqual({
      question: "Which?",
      options: ["A", "B"],
      multi: true,
      questions: [{ question: "Which?", options: ["A", "B"], multi: true }],
    });
  });

  it("reads a one-question list, and multi: false, as the plain card", () => {
    for (const body of [
      '{"questions": [{"question": "Which?", "options": ["A", "B"]}]}',
      '{"question": "Which?", "options": ["A", "B"], "multi": false}',
    ]) {
      expect(parseQuestionBlock(block("agent-question", body)).question).toEqual({
        question: "Which?",
        options: ["A", "B"],
      });
    }
  });

  it("rejects an empty list, a non-boolean multi, or any invalid question", () => {
    for (const body of [
      '{"questions": []}',
      '{"questions": "Which?"}',
      '{"question": "Which?", "options": ["A"], "multi": "yes"}',
      '{"questions": [{"question": "Ok?", "options": ["A"]}, {"question": "Bad?", "options": []}]}',
      '{"questions": [{"question": "Ok?", "options": ["A"]}, {"question": "Ok?", "options": ["A"], "multi": 1}]}',
      '{"questions": [{"question": "Ok?", "options": ["A"]}, "Bad?"]}',
    ]) {
      const raw = block("agent-question", body);
      expect(parseQuestionBlock(raw).question).toBeNull();
      expect(parseQuestionBlock(raw).text).toBe(raw);
    }
  });

  it("takes any number of questions", () => {
    const questions = Array.from({ length: 12 }, (_, i) => ({ question: `Q${i}?`, options: ["A", "B"] }));
    const parsed = parseQuestionBlock(block("agent-question", JSON.stringify({ questions })));
    expect(parsed.question?.questions).toHaveLength(12);
  });
});

describe("formatQuestionAnswers", () => {
  it("numbers each question with its answers, and marks the ones left", () => {
    const items = [
      { question: "Where?", options: ["Settings"] },
      { question: "Refresh?", options: ["Live"] },
      { question: "Split by?", options: ["Machine", "Model"], multi: true },
    ];
    expect(formatQuestionAnswers(items, [["Settings"], [], ["Machine", "Model"]])).toBe(
      "1. Where? → Settings\n2. Refresh? → (skipped)\n3. Split by? → Machine; Model",
    );
  });

  it("keeps each question on one line", () => {
    const items = [{ question: "Where\nshould it  go?", options: ["A"] }];
    expect(formatQuestionAnswers(items, [["Over\n there "]])).toBe("1. Where should it go? → Over there");
  });

  it("drops blank answers", () => {
    const items = [{ question: "Q?", options: ["A"] }];
    expect(formatQuestionAnswers(items, [["  "]])).toBe("1. Q? → (skipped)");
  });
});

