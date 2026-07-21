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
 */

import {
  CONTROLS_BLOCK_NAME,
  LEGACY_CONTROLS_BLOCK_NAME,
  LEGACY_QUESTION_BLOCK_NAME,
  QUESTION_BLOCK_NAME,
  VIEW_BLOCK_NAME,
} from "../prompt";

const FENCE = "```";

/** Info strings whose block the completed message renders as a card. */
const AGENT_BLOCK_NAMES: ReadonlySet<string> = new Set([
  QUESTION_BLOCK_NAME,
  CONTROLS_BLOCK_NAME,
  VIEW_BLOCK_NAME,
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
}

export interface TextDeltaStream {
  push(chunk: string): TextStreamResult;
  /** Begins the next assistant message, dropping any withheld state. */
  reset(): void;
}

export function createTextDeltaStream(): TextDeltaStream {
  let raw = "";
  let emitted = 0;
  let suppressed = false;
  /** Inside an agent-view block: the scan position for completed lines, or
   * null when suppression is not view-flavored (question/controls) or the
   * view block has closed. */
  let viewScan: number | null = null;

  const lineStartFence = (from: number): number => {
    let at = raw.indexOf(FENCE, from);
    while (at !== -1) {
      if (at === 0 || raw[at - 1] === "\n") return at;
      at = raw.indexOf(FENCE, at + 1);
    }
    return -1;
  };

  /** Length of a trailing backtick run that could still grow into a fence. */
  const heldTail = (): number => {
    const tail = raw.slice(raw.lastIndexOf("\n") + 1);
    return /^`{1,2}$/.test(tail) ? tail.length : 0;
  };

  const take = (end: number): string => {
    if (end <= emitted) return "";
    const out = raw.slice(emitted, end);
    emitted = end;
    return out;
  };

  /** Completed lines inside the view block since the last push. A line that
   * closes the block ends collection; later content stays suppressed. */
  const collectViewLines = (): string[] => {
    const lines: string[] = [];
    while (viewScan !== null) {
      const newline = raw.indexOf("\n", viewScan);
      if (newline === -1) break;
      const line = raw.slice(viewScan, newline).trimEnd();
      viewScan = newline + 1;
      if (line.trim().startsWith(FENCE)) {
        viewScan = null;
        break;
      }
      if (line.trim()) lines.push(line);
    }
    return lines;
  };

  return {
    push(chunk) {
      raw += chunk;
      if (suppressed) return { text: "", viewLines: collectViewLines() };
      let scan = emitted;
      for (;;) {
        const fence = lineStartFence(scan);
        if (fence === -1) break;
        const infoEnd = raw.indexOf("\n", fence + FENCE.length);
        // The info string is still arriving, so the block's kind is unknown —
        // release everything before the fence and wait.
        if (infoEnd === -1) return { text: take(fence), viewLines: [] };
        const info = raw.slice(fence + FENCE.length, infoEnd).trim();
        if (AGENT_BLOCK_NAMES.has(info)) {
          const out = take(fence);
          suppressed = true;
          if (info === VIEW_BLOCK_NAME) viewScan = infoEnd + 1;
          return { text: out, viewLines: collectViewLines() };
        }
        // An ordinary code block streams like any other prose; keep scanning
        // past it in case a generative-UI block follows.
        scan = infoEnd + 1;
      }
      return { text: take(raw.length - heldTail()), viewLines: [] };
    },

    reset() {
      raw = "";
      emitted = 0;
      suppressed = false;
      viewScan = null;
    },
  };
}
