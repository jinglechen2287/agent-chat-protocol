/**
 * Fence-aware chunking for streamed assistant prose.
 *
 * A message may end with a generative-UI block (```agent-question```,
 * ```agent-controls```, ```agent-view```) that the *completed* message lifts
 * into its own event. Streaming such a block through verbatim would flash raw
 * JSON in the transcript a moment before the rendered card replaces it, so
 * the streamer stops emitting text at the opening fence.
 *
 * View blocks get a third behavior: while suppressed from the text stream,
 * each *completed line* inside the block is surfaced separately so the bridge
 * can stream validated components into a skeleton view. Question and controls
 * blocks stay fully suppressed — they render as one card, so partial delivery
 * has nothing to hydrate.
 *
 * The remaining job is not splitting a fence: a fragment can end mid-marker,
 * and ```` ``` ```` on its own tells us nothing until the info string that
 * follows it arrives. Those bytes are withheld until they can be classified.
 *
 * A `<proposed_plan>` block is the exception to all of it. Its body is markdown
 * that may show any of these fences as examples, and the completed message
 * lifts the plan first, so inside one they are text like any other.
 *
 * The streamer reads one line at a time and keeps only the unfinished line,
 * so each push costs its own length, not the length of the message so far.
 */

import { closingLine } from "../block";
import {
  CONTROLS_BLOCK_NAME,
  HTML_BLOCK_NAME,
  LEGACY_CONTROLS_BLOCK_NAME,
  LEGACY_QUESTION_BLOCK_NAME,
  QUESTION_BLOCK_NAME,
  VIEW_BLOCK_NAME,
} from "../prompt";

const FENCE = "```";

/** A plan tag alone on its line, by the line rules of plan.ts's block match. */
const PLAN_TAG_LINE = /^[^\S\r\n]*<(\/?)proposed_plan>[^\S\r\n]*\r?$/gm;

/** Info strings whose block the completed message renders as a card. */
const AGENT_BLOCK_NAMES: ReadonlySet<string> = new Set([
  QUESTION_BLOCK_NAME,
  CONTROLS_BLOCK_NAME,
  VIEW_BLOCK_NAME,
  HTML_BLOCK_NAME,
  LEGACY_QUESTION_BLOCK_NAME,
  LEGACY_CONTROLS_BLOCK_NAME,
]);

export interface TextStreamResult {
  /** The portion of the pushed text safe to emit as prose ("" when all of it
   * is withheld). */
  text: string;
  /** Raw completed lines from inside an agent-view block, in order. Empty
   * outside view blocks. The closing fence is never included. */
  viewLines: string[];
  /** Completed lines from inside an agent-html block, newline-terminated and
   * verbatim — indentation and blank lines are content there. Empty outside
   * html blocks; the closing fence is never included. */
  htmlLines: string[];
}

export interface TextDeltaStream {
  push(chunk: string): TextStreamResult;
  /** Begins the next assistant message, dropping any withheld state. */
  reset(): void;
}

/** What one push collects before it becomes a {@link TextStreamResult}. */
interface Collected {
  prose: string[];
  viewLines: string[];
  htmlLines: string[];
}

export function createTextDeltaStream(): TextDeltaStream {
  /** What the stream is reading: prose, the lines of a view or html block, or
   * nothing more (a question or controls block, or a view or html block that
   * has closed: the rest of the message is suppressed). */
  let mode: "prose" | "view" | "html" | "done" = "prose";
  /** Where the message's first plan block stands, the only one a completed
   * message lifts. A closing tag after its opening tag closes it for good. */
  let plan: "before" | "open" | "closed" = "before";
  /** The unfinished line, in the chunks it arrived in; joined once, when its
   * newline arrives, so a long line costs its length once and not per push. */
  let line: string[] = [];
  let lineLength = 0;
  /** The unfinished line's first three characters: enough to tell a fence. */
  let head = "";
  /** The part of the unfinished line not emitted yet. */
  let unemitted: string[] = [];

  const resetLine = (): void => {
    line = [];
    lineLength = 0;
    head = "";
    unemitted = [];
  };

  /** Whether the unfinished line must be withheld because it may still turn
   * into a fence that opens a generative-UI block: one or two backticks so
   * far, or a fence outside the plan whose info string hasn't ended. Inside
   * the plan a fence is plain text, since the completed message lifts the
   * plan first. */
  const withheld = (): boolean =>
    head === FENCE ? plan !== "open" : lineLength <= 2 && /^`+$/.test(head);

  const readPlanTags = (text: string): void => {
    if (plan === "closed") return;
    for (const tag of text.matchAll(PLAN_TAG_LINE)) {
      if (tag[1] === "") plan = "open";
      else if (plan === "open") {
        plan = "closed";
        return;
      }
    }
  };

  /** Handles one completed line, given without its "\n". */
  const completeLine = (text: string, out: Collected): void => {
    if (mode === "prose") {
      if (head === FENCE && plan !== "open") {
        // The fence line was withheld whole; its info string says what opens.
        const info = text.slice(FENCE.length).trim();
        if (AGENT_BLOCK_NAMES.has(info)) {
          mode = info === VIEW_BLOCK_NAME ? "view" : info === HTML_BLOCK_NAME ? "html" : "done";
          return;
        }
        // An ordinary code block streams like any other prose.
      }
      out.prose.push(unemitted.join(""), "\n");
      readPlanTags(text);
      return;
    }
    const content = text.replace(/\r$/, "");
    // The completed parser's closing rule: a bare ``` line closes either block
    // (a content line like ```js opens a nested fence instead), and a view
    // also closes at a record that ends in ```.
    const close = closingLine(content, mode === "view");
    if (close) {
      if (close.bodyTail.trim()) out.viewLines.push(close.bodyTail.trimEnd());
      mode = "done";
    } else if (mode === "html") {
      // Whitespace is content in a page: html lines stay verbatim.
      out.htmlLines.push(`${content}\n`);
    } else if (content.trim()) {
      // Each view line is one JSON object.
      out.viewLines.push(content.trimEnd());
    }
  };

  return {
    push(chunk) {
      const out: Collected = { prose: [], viewLines: [], htmlLines: [] };
      let at = 0;
      while (mode !== "done") {
        const newline = chunk.indexOf("\n", at);
        const piece = chunk.slice(at, newline === -1 ? chunk.length : newline);
        if (piece) {
          line.push(piece);
          unemitted.push(piece);
          lineLength += piece.length;
          if (head.length < FENCE.length) head += piece.slice(0, FENCE.length - head.length);
        }
        if (newline === -1) break;
        completeLine(line.join(""), out);
        resetLine();
        at = newline + 1;
      }
      if (mode === "done") {
        resetLine();
      } else if (mode === "prose" && !withheld()) {
        out.prose.push(unemitted.join(""));
        unemitted = [];
      }
      return { text: out.prose.join(""), viewLines: out.viewLines, htmlLines: out.htmlLines };
    },

    reset() {
      mode = "prose";
      plan = "before";
      resetLine();
    },
  };
}
