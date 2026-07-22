import { describe, expect, it } from "vitest";
import {
  HTML_BLOCK_NAME,
  HTML_PROMPT,
  HTML_SEND_MAX,
  parseHtmlBlock,
  parseHtmlFrameMessage,
} from "../src/index";

const DOC = "<!doctype html>\n<html><head><style>body{margin:0}</style></head>\n<body><h1>Hi</h1></body></html>";

const block = (body: string): string => ["```" + HTML_BLOCK_NAME, body, "```"].join("\n");

describe("parseHtmlBlock", () => {
  it("extracts the document and strips the block from the prose", () => {
    const parsed = parseHtmlBlock(`Here is the page.\n\n${block(DOC)}`);
    expect(parsed.text).toBe("Here is the page.");
    expect(parsed.html).toBe(DOC);
  });

  it("returns null html when there is no block", () => {
    const parsed = parseHtmlBlock("Just prose.");
    expect(parsed.html).toBeNull();
    expect(parsed.text).toBe("Just prose.");
  });

  it("leaves an empty block as prose", () => {
    const raw = block("   \n  ");
    const parsed = parseHtmlBlock(raw);
    expect(parsed.html).toBeNull();
    expect(parsed.text).toBe(raw);
  });

  it("preserves interior blank lines and indentation", () => {
    const body = "<pre>\n  indented\n\n  after blank\n</pre>";
    expect(parseHtmlBlock(block(body)).html).toBe(body);
  });

  it("only closes on a fence at the start of a line", () => {
    // A template literal containing backticks must not end the block early.
    const body = "<script>const s = `a``b`;</script>";
    expect(parseHtmlBlock(block(body)).html).toBe(body);
  });

  it("does not close on a content line that opens a nested fence", () => {
    // A page showing a markdown example: ```js opens a fence, only a bare
    // ``` line closes the block.
    const body = "<pre>\n```js\nconsole.log(1)\n</pre>";
    expect(parseHtmlBlock(block(body)).html).toBe(body);
  });

  it("ignores ordinary fenced blocks", () => {
    const raw = "Look:\n\n```html\n<b>x</b>\n```";
    const parsed = parseHtmlBlock(raw);
    expect(parsed.html).toBeNull();
    expect(parsed.text).toBe(raw);
  });

  it("leaves an oversized block as prose, measured in bytes", () => {
    // 100k euro signs: under the ceiling in UTF-16 units, over it in bytes.
    const raw = block(`<p>${"€".repeat(100_000)}</p>`);
    expect(raw.length).toBeLessThan(262_144);
    expect(parseHtmlBlock(raw).html).toBeNull();
    expect(parseHtmlBlock(raw).text).toBe(raw);
  });

  it("extracts only the first block", () => {
    const raw = `${block("<p>one</p>")}\n\n${block("<p>two</p>")}`;
    const parsed = parseHtmlBlock(raw);
    expect(parsed.html).toBe("<p>one</p>");
    expect(parsed.text).toContain("<p>two</p>");
  });
});

describe("parseHtmlFrameMessage", () => {
  it("accepts the three frame-to-parent shapes", () => {
    expect(parseHtmlFrameMessage({ type: "agent-html:ready" })).toEqual({ type: "agent-html:ready" });
    expect(parseHtmlFrameMessage({ type: "agent-html:height", height: 320 }))
      .toEqual({ type: "agent-html:height", height: 320 });
    expect(parseHtmlFrameMessage({ type: "agent-html:send", text: "Rerun" }))
      .toEqual({ type: "agent-html:send", text: "Rerun" });
  });

  it("rejects malformed or hostile payloads", () => {
    expect(parseHtmlFrameMessage(null)).toBeNull();
    expect(parseHtmlFrameMessage("agent-html:ready")).toBeNull();
    expect(parseHtmlFrameMessage({ type: "agent-html:height", height: Infinity })).toBeNull();
    expect(parseHtmlFrameMessage({ type: "agent-html:height", height: -5 })).toBeNull();
    expect(parseHtmlFrameMessage({ type: "agent-html:send", text: "" })).toBeNull();
    expect(parseHtmlFrameMessage({ type: "agent-html:send", text: "x".repeat(HTML_SEND_MAX + 1) }))
      .toBeNull();
    expect(parseHtmlFrameMessage({ type: "agent-html:navigate", url: "https://x" })).toBeNull();
  });
});

describe("HTML_PROMPT", () => {
  it("states the load-bearing rules", () => {
    expect(HTML_PROMPT).toContain(HTML_BLOCK_NAME);
    expect(HTML_PROMPT).toContain("AgentBridge.send");
    expect(HTML_PROMPT).toContain("<style>");
    expect(HTML_PROMPT).toContain("<script>");
    expect(HTML_PROMPT).toContain(String(HTML_SEND_MAX));
  });

  it("separates surface variables from text variables", () => {
    // --muted alone reads as "muted text color" and produces invisible
    // text on the near-identical background; the prompt must teach the
    // surface/foreground pairs explicitly.
    expect(HTML_PROMPT).toContain("--muted-foreground");
    expect(HTML_PROMPT).toContain("--accent-foreground");
    expect(HTML_PROMPT).toContain("never for text");
  });
});
