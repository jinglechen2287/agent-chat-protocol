import { describe, expect, it } from "vitest";
import type { ChatStreamEvent } from "../src/index";
import { createChatEventBridge } from "../src/server/index";

/** What a client rebuilds from one message's fragments: the prose, the html
 * scratch document, and the streamed view components, in order. */
function streamed(chunks: readonly string[]): { text: string; html: string; views: unknown[] } {
  const events: ChatStreamEvent[] = [];
  const bridge = createChatEventBridge((ev) => events.push(ev));
  for (const chunk of chunks) bridge.callbacks.onAssistantTextDelta(chunk);
  let text = "";
  let html = "";
  const views: unknown[] = [];
  for (const ev of events) {
    if (ev.type === "assistant_text_delta") text += ev.delta;
    else if (ev.type === "html_delta") html += ev.delta;
    else if (ev.type === "view_line") views.push(ev.component);
  }
  return { text, html, views };
}

const viewLine = (id: string, value: string): string =>
  JSON.stringify({ id, type: "Text", value });

const PLAN_WITH_FENCES = [
  "Intro",
  "<proposed_plan>",
  "# Plan",
  "```agent-view",
  viewLine("root", "an example inside the plan"),
  "```",
  "```ts",
  "const x = `y`;",
  "```",
  "</proposed_plan>",
  "",
].join("\n");

const FIXTURES: Record<string, string> = {
  prose: "Hello **world**.\nA line with `code` and ``two`` ticks.\n",
  "ordinary code fence": "Look:\n```ts\nconst a = `x`;\n```\nAfter the block.\n",
  "view block": [
    "Summary first.",
    "```agent-view",
    JSON.stringify({ id: "root", type: "Stack", children: ["t"] }),
    viewLine("t", "hi"),
    "```",
    "",
  ].join("\n"),
  "html block": "Page:\n```agent-html\n<!doctype html>\n<p>a</p>\n\n  <p>b</p>\n```\n",
  "question block": 'Pick one.\n```agent-question\n{"question":"Which?","options":["A","B"]}\n```',
  "plan containing fences": PLAN_WITH_FENCES,
  "plan followed by a view": `${PLAN_WITH_FENCES}\`\`\`agent-view\n${viewLine("root", "real")}\n\`\`\`\n`,
  "CRLF view block": `Line\r\n\`\`\`agent-view\r\n${viewLine("root", "crlf")}\r\n\`\`\`\r\n`,
  "indented view block": [
    "Intro, as a list item:",
    "  ```agent-view",
    `  ${viewLine("root", "indented")}`,
    "  ```",
    "",
  ].join("\n"),
  "indented ordinary fence": "Steps:\n   ```sh\n   bun test\n   ```\n  done\n",
    "CRLF plan tags": "<proposed_plan>\r\n```agent-question\r\n{}\r\n```\r\n</proposed_plan>\r\nafter\n",
};

describe("streamed text does not depend on where chunks split", () => {
  for (const [name, message] of Object.entries(FIXTURES)) {
    it(name, () => {
      const whole = streamed([message]);
      for (let i = 1; i < message.length; i += 1) {
        expect(streamed([message.slice(0, i), message.slice(i)]), `split at ${i}`).toEqual(whole);
        for (let j = i + 1; j < message.length; j += 3) {
          expect(
            streamed([message.slice(0, i), message.slice(i, j), message.slice(j)]),
            `split at ${i} and ${j}`,
          ).toEqual(whole);
        }
      }
    });
  }
});

describe("a line that arrives in very many pieces", () => {
  it("streams a fence line split into 200,000 one-character deltas", () => {
    const fenceLine = "```" + "x".repeat(200_000);
    const { text } = streamed([...fenceLine.split(""), "\n", "after\n"]);
    expect(text).toBe(`${fenceLine}\nafter\n`);
  });
});

describe("an indented opening fence", () => {
  it("streams the block's components instead of its markup", () => {
    const message = ["Intro:", "  ```agent-view", `  ${viewLine("root", "indented")}`, "  ```", ""].join("\n");
    const result = streamed(message.match(/[\s\S]{1,5}/g) ?? []);
    expect(result.views).toEqual([{ id: "root", type: "Text", value: "indented" }]);
    expect(result.text).toBe("Intro:\n");
  });
});

describe("the opening-fence rule streaming shares with the completed parser", () => {
  for (const indent of ["", "  "]) {
    it(`streams ${indent ? "an indented" : "a"} fence with a space before the block name as prose`, () => {
      const message = `Intro\n${indent}\`\`\` agent-html\n<p>x</p>\n${indent}\`\`\`\nafter\n`;
      expect(streamed(message.match(/[\s\S]{1,4}/g) ?? []).text).toBe(message);
    });
  }
});

describe("plan tags follow the completed parser's line rule", () => {
  it("streams a view whose fence follows a plan tag that shares its line with text", () => {
    const message = `x\r<proposed_plan>\n\`\`\`agent-view\n${viewLine("root", "lifted")}\n\`\`\`\n`;
    expect(streamed(message.match(/[\s\S]{1,3}/g) ?? []).views).toEqual([
      { id: "root", type: "Text", value: "lifted" },
    ]);
  });
});

describe("streamed view records are trimmed like completed ones", () => {
  it("streams records that start with a non-breaking space", () => {
    const message = `\`\`\`agent-view\n ${viewLine("root", "a")}\n ${viewLine("b", "b")}\`\`\`\n`;
    expect(streamed(message.match(/[\s\S]{1,4}/g) ?? []).views).toEqual([
      { id: "root", type: "Text", value: "a" },
      { id: "b", type: "Text", value: "b" },
    ]);
  });
});
