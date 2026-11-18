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
