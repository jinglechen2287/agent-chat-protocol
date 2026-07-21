/**
 * Fence-aware chunking for streamed assistant prose.
 *
 * A message may end with a generative-UI block (```agent-question```,
 * ```agent-controls```) that the *completed* message lifts into its own event.
 * Streaming that block through verbatim would flash raw JSON in the transcript
 * a moment before the rendered card replaces it, so the streamer stops at the
 * opening fence and lets the completed message speak for the remainder.
 *
 * The other job is not splitting a fence: a fragment can end mid-marker, and
 * ```` ``` ```` on its own tells us nothing until the info string that follows
 * it arrives. Those bytes are withheld until they can be classified.
 */

import {
  CONTROLS_BLOCK_NAME,
  LEGACY_CONTROLS_BLOCK_NAME,
  LEGACY_QUESTION_BLOCK_NAME,
  QUESTION_BLOCK_NAME,
} from "../prompt";

const FENCE = "```";

/** Info strings whose block the completed message renders as a card. Mirrors
 * what the question/controls parsers accept, legacy fences included. */
const AGENT_BLOCK_NAMES: ReadonlySet<string> = new Set([
  QUESTION_BLOCK_NAME,
  CONTROLS_BLOCK_NAME,
  LEGACY_QUESTION_BLOCK_NAME,
  LEGACY_CONTROLS_BLOCK_NAME,
]);

export interface TextDeltaStream {
  /** Accepts a raw fragment and returns the portion safe to emit, which is
   * `""` when everything so far is withheld. */
  push(chunk: string): string;
  /** Begins the next assistant message, dropping any withheld text. */
  reset(): void;
}

export function createTextDeltaStream(): TextDeltaStream {
  let raw = "";
  let emitted = 0;
  let suppressed = false;

  /** First fence marker at or after `from` that opens a line — an indented or
   * mid-sentence run of backticks is inline code, not a block. */
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

  return {
    push(chunk) {
      raw += chunk;
      if (suppressed) return "";
      let scan = emitted;
      for (;;) {
        const fence = lineStartFence(scan);
        if (fence === -1) break;
        const infoEnd = raw.indexOf("\n", fence + FENCE.length);
        // The info string is still arriving, so the block's kind is unknown —
        // release everything before the fence and wait.
        if (infoEnd === -1) return take(fence);
        const info = raw.slice(fence + FENCE.length, infoEnd).trim();
        if (AGENT_BLOCK_NAMES.has(info)) {
          const out = take(fence);
          suppressed = true;
          return out;
        }
        // An ordinary code block streams like any other prose; keep scanning
        // past it in case a generative-UI block follows.
        scan = infoEnd + 1;
      }
      return take(raw.length - heldTail());
    },

    reset() {
      raw = "";
      emitted = 0;
      suppressed = false;
    },
  };
}
