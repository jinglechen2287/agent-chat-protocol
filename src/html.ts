/**
 * The ```agent-html``` grammar: a freeform generated page, streamed raw and
 * rendered in a sandboxed frame — the escape hatch for layouts and
 * interactions the component catalog can't express.
 *
 * Unlike a view, the block body is not validated structure: it is an HTML
 * document the client morphs into the frame as it streams and re-mounts
 * whole once complete. The only vocabulary the protocol fixes is the
 * postMessage bridge between the frame and its host, defined here so both
 * sides (and the prompt that teaches the in-page `AgentBridge` API) cannot
 * drift.
 *
 * Degradation matches views: an empty or oversized block stays in the prose
 * as plain text.
 */

import { HTML_BLOCK_NAME } from "./prompt";

/** Byte ceiling for a block; larger ones degrade to prose. */
const MAX_HTML_BYTES = 262_144;

/** Longest text a frame's `AgentBridge.send` may submit as the next user
 * message — mirrors the view catalog's Button message cap. */
export const HTML_SEND_MAX = 1_000;

// --- Bridge messages -------------------------------------------------------

/** Host → frame: the accumulated document so far; `done` marks the final
 * frame, after which scripts are live and no further updates arrive. */
export interface HtmlUpdateMessage {
  type: "agent-html:update";
  html: string;
  done: boolean;
}

/** Host → frame: the app's active color scheme changed. */
export interface HtmlThemeMessage {
  type: "agent-html:theme";
  theme: "light" | "dark";
}

export type HtmlParentToFrame = HtmlUpdateMessage | HtmlThemeMessage;

/** Frame → host: bootstrap is loaded and listening; updates may start. */
export interface HtmlReadyMessage {
  type: "agent-html:ready";
}

/** Frame → host: the document's content height, for sizing the iframe. */
export interface HtmlHeightMessage {
  type: "agent-html:height";
  height: number;
}

/** Frame → host: text to submit as the user's next chat message (the
 * freeform twin of a view Button's message template). */
export interface HtmlSendMessage {
  type: "agent-html:send";
  text: string;
}

export type HtmlFrameToParent = HtmlReadyMessage | HtmlHeightMessage | HtmlSendMessage;

/**
 * Validates a frame-origin postMessage payload. The frame runs agent-authored
 * code, so the host treats its messages as untrusted input: unknown types,
 * non-finite heights, and over-long send texts are rejected.
 */
export function parseHtmlFrameMessage(data: unknown): HtmlFrameToParent | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const { type } = data as Record<string, unknown>;
  if (type === "agent-html:ready") return { type };
  if (type === "agent-html:height") {
    const { height } = data as Record<string, unknown>;
    if (typeof height !== "number" || !Number.isFinite(height) || height < 0) return null;
    return { type, height };
  }
  if (type === "agent-html:send") {
    const { text } = data as Record<string, unknown>;
    if (typeof text !== "string" || text.length === 0 || text.length > HTML_SEND_MAX) return null;
    return { type, text };
  }
  return null;
}

// --- Block parsing ---------------------------------------------------------

export interface ParsedHtmlText {
  /** The message text with a valid html block removed and trimmed. */
  text: string;
  /** The block body, or null when the message had no renderable block. */
  html: string | null;
}

/** Matches the first agent-html fenced block. The closing fence must sit
 * alone on its own line (optional surrounding whitespace) so backticks
 * inside the document — a JS template literal or a ```js example line —
 * cannot end the block early. */
const BLOCK_RE = new RegExp(
  "```" + HTML_BLOCK_NAME + "[^\\S\\r\\n]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*```[ \\t]*(?=\\r?\\n|$)",
);

/**
 * Extracts the first ```agent-html``` block. An empty or oversized block is
 * left in the prose as plain text, exactly like a rootless view block.
 */
export function parseHtmlBlock(raw: string): ParsedHtmlText {
  const match = BLOCK_RE.exec(raw);
  if (!match) return { text: raw, html: null };

  const body = (match[1] ?? "").replace(/\r\n/g, "\n");
  const oversized = new TextEncoder().encode(body).length > MAX_HTML_BYTES;
  if (oversized || body.trim().length === 0) return { text: raw, html: null };

  const text = (raw.slice(0, match.index) + raw.slice(match.index + match[0].length))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, html: body };
}

// --- Prompt ----------------------------------------------------------------

/** The prompt section that teaches the html block and the in-frame bridge
 * API. Apps append it behind the user's request in experiment-style modes;
 * a test keeps it covering the load-bearing rules. */
export const HTML_PROMPT: string = [
  "- This conversation is in experiment mode: the user has explicitly asked for bespoke generated pages. Default to answering with one — reach for it whenever the reply benefits from layout, styling, or interaction. Plain prose alone is right only when there is genuinely nothing to show (a yes/no, a pure opinion).",
  "- Lead with a sentence or two of prose when context helps, then end the message with one fenced block containing a complete HTML document:",
  "  ```" + HTML_BLOCK_NAME,
  "  <!doctype html>",
  '  <html><head><style>/* all styles inline here */</style></head>',
  "  <body>…<script>/* behavior last */</script></body></html>",
  "  ```",
  "- The client renders the document in a sandboxed frame *while it streams*, top to bottom. Put one <style> tag in <head> before any body content so partial pages are styled from the first paint; put <script> tags at the very end of <body> — they run once the document is complete, never against a half-built DOM.",
  `- The frame exposes window.AgentBridge. Calling AgentBridge.send("text") submits that text (max ${HTML_SEND_MAX} chars) as the user's next chat message — wire buttons, forms, and selections to it for anything that should continue the conversation. There is no other host API; do not use fetch, XHR, or navigation.`,
  "- The frame loads no external resources: no CDN scripts, stylesheets, or fonts — inline everything. Images may use https URLs.",
  "- Design mobile-first (~390px wide) and theme-aware: the host defines CSS variables on :root and keeps them matching the app's light/dark scheme — build your palette from them (e.g. color-mix with a fixed hue) instead of hardcoding page-wide colors. Surface fills, never for text: --background, --muted, --accent (each sits close to the page background). Text colors: --foreground for primary text, --muted-foreground for secondary text, --accent-foreground on an --accent surface. Lines: --border.",
  "- Never invent data to fill a page: render the real values you have, fetching or computing them first when tools allow. When the data genuinely isn't available, say so instead of rendering placeholders.",
].join("\n");
