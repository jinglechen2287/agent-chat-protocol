import { describe, expect, it } from "vitest";
import {
  parseHtmlBlock,
  parseQuestionBlock,
  parseViewBlock,
  type ChatStreamEvent,
} from "../src/index";
import { createChatEventBridge } from "../src/server/index";

const record = (value: object): string => JSON.stringify(value);
const root = record({ id: "root", type: "Stack", children: ["m", "t"] });
const markdown = record({ id: "m", type: "Markdown", value: "Run:\n```sh\nbun test\n```" });
const last = record({ id: "t", type: "Text", value: "after" });

/** Streams `message` through a bridge in small chunks, then completes it. */
function bridged(message: string): ChatStreamEvent[] {
  const events: ChatStreamEvent[] = [];
  const bridge = createChatEventBridge((ev) => events.push(ev));
  for (let at = 0; at < message.length; at += 7) {
    bridge.callbacks.onAssistantTextDelta(message.slice(at, at + 7));
  }
  bridge.callbacks.onAssistantText(message);
  return events;
}

const streamedIds = (events: ChatStreamEvent[]): string[] =>
  events.flatMap((ev) => (ev.type === "view_line" ? [ev.component.id] : []));
const finalIds = (events: ChatStreamEvent[]): string[] =>
  events.flatMap((ev) => (ev.type === "view" ? ev.spec.components.map((c) => c.id) : []));

describe("a fenced block closes at its own closing line", () => {
  const fencedMarkdownView = ["Intro", "```agent-view", root, markdown, last, "```", "Outro"].join("\n");

  it("renders every component when a Markdown value contains a code fence", () => {
    const parsed = parseViewBlock(fencedMarkdownView);
    expect(parsed.view?.components.map((c) => c.id)).toEqual(["root", "m", "t"]);
    expect(parsed.text).toBe("Intro\n\nOutro");
  });

  it("streams the same components the completed view renders", () => {
    const events = bridged(fencedMarkdownView);
    expect(streamedIds(events)).toEqual(["root", "m", "t"]);
    expect(finalIds(events)).toEqual(["root", "m", "t"]);
  });

  it("still closes at a `}` followed by ``` at the end of a line, keeping later prose and code", () => {
    const message = [
      "Intro",
      "```agent-view",
      root,
      markdown,
      `${last}\`\`\``,
      "",
      "Some prose",
      "",
      "```js",
      "const x = 1;",
      "```",
    ].join("\n");
    const parsed = parseViewBlock(message);
    expect(parsed.view?.components.map((c) => c.id)).toEqual(["root", "m", "t"]);
    expect(parsed.text).toBe("Intro\n\nSome prose\n\n```js\nconst x = 1;\n```");
    expect(streamedIds(bridged(message))).toEqual(["root", "m", "t"]);
  });

  it("keeps every question option when a label contains ```", () => {
    const parsed = parseQuestionBlock(
      'Which?\n```agent-question\n{"question": "Run which?", "options": ["Run ```npm test```", "Skip"]}\n```',
    );
    expect(parsed.question?.options).toEqual(["Run ```npm test```", "Skip"]);
    expect(parsed.text).toBe("Which?");
  });

  it("keeps the prose after an empty view block", () => {
    const parsed = parseViewBlock(
      ["```agent-view", "```", "prose here", "```agent-view", record({ id: "root", type: "Text", value: "v" }), "```"].join("\n"),
    );
    expect(parsed.text).toContain("prose here");
  });

  it("keeps the prose after an empty html block", () => {
    const parsed = parseHtmlBlock(["```agent-html", "```", "prose here", "```agent-html", "<p>x</p>", "```"].join("\n"));
    expect(parsed.text).toContain("prose here");
  });

  it("closes at a fence line padded with non-breaking spaces", () => {
    const view = parseViewBlock(["```agent-view", record({ id: "root", type: "Text", value: "v" }), "``` ", "After prose"].join("\n"));
    expect(view.view?.components.map((c) => c.id)).toEqual(["root"]);
    expect(view.text).toBe("After prose");
    const html = parseHtmlBlock(["```agent-html", "<p>x</p>", " ``` ", "After prose"].join("\n"));
    expect(html.html).toBe("<p>x</p>");
    expect(html.text).toBe("After prose");
  });
});

describe("the first ``` outside a JSON string closes a JSON block", () => {
  it("leaves the rest of the closing line, and what follows, in the prose", () => {
    const parsed = parseViewBlock(
      ["Intro", "```agent-view", `${record({ id: "root", type: "Text", value: "v" })}\`\`\` more prose`, "", "```js", "x", "```"].join("\n"),
    );
    expect(parsed.view?.components.map((c) => c.id)).toEqual(["root"]);
    expect(parsed.text).toBe("Intro\n more prose\n\n```js\nx\n```");
  });
});

describe("a malformed last record", () => {
  it("still closes at a fence after an unmatched quote, rendering the valid records", () => {
    const parsed = parseViewBlock(
      ["```agent-view", record({ id: "root", type: "Text", value: "v" }), '{"id":"t","type":"Text","value":"abc```'].join("\n"),
    );
    expect(parsed.view?.components.map((c) => c.id)).toEqual(["root"]);
  });
});
