/**
 * The steps every generative-UI block parser shares: find the first block,
 * decode its body, and cut it out of the surrounding prose. Internal: not
 * re-exported from either entry.
 */

let encoder: InstanceType<typeof TextEncoder> | undefined;

/** Size of `text` in UTF-8 bytes, the unit every block ceiling is set in. The
 * encoder is made on first use, so importing the package doesn't need a global
 * `TextEncoder` until a parser measures something. */
export function utf8Length(text: string): number {
  if (!encoder) encoder = new TextEncoder();
  return encoder.encode(text).length;
}

/** Where a block sits in the message, and its body. */
export interface BlockMatch {
  /** Offset of the block's first character. */
  index: number;
  /** Offset just past its closing line. */
  end: number;
  body: string;
}

export type BlockFinder = (raw: string) => BlockMatch | null;

/**
 * A finder from a grammar split at the end of its opening line: `open`
 * (global) finds the opening line, and `rest` (sticky) matches the body,
 * group 1, and the closing line from where the opening ends.
 *
 * Only the first opener is tried. Any closer after a later opener also comes
 * after the first, and the body may span opener lines, so if any opener
 * matches the first one does: the result equals an unanchored search, without
 * the unanchored search's restart at every opener, which made a run of
 * unclosed openers cost time quadratic in the message length.
 */
export function splitPatternFinder(open: RegExp, rest: RegExp): BlockFinder {
  return (raw) => {
    // Shared module-level regexes carry lastIndex between calls.
    open.lastIndex = 0;
    const opening = open.exec(raw);
    if (!opening) return null;
    rest.lastIndex = opening.index + opening[0].length;
    const tail = rest.exec(raw);
    if (!tail) return null;
    return { index: opening.index, end: rest.lastIndex, body: tail[1] ?? "" };
  };
}

const FENCE = "```";

/**
 * Where one line of a fenced block, its "\r" already stripped, closes the
 * block, or null when it doesn't. The completed parser and the streamer both
 * ask this, so they can't disagree about where a block ends.
 *
 * - A line holding only ``` closes any block, whitespace around it allowed
 *   (the whitespace `trim()` removes), and the whole line goes with it.
 * - With `json`, for blocks whose body is JSON (question, controls, view),
 *   the first ``` outside a JSON string closes the block too, wherever it sits
 *   on the line: what precedes it is the last of the body, and what follows
 *   it stays prose. A ``` inside a string, such as a code fence in a Markdown
 *   component's value, never closes the block, unless the string is still
 *   open at the end of the line, which no valid JSON is.
 *
 * `bodyTail` is the part of the line that belongs to the body; `end` is where
 * the block ends within the line.
 */
export function closingLine(line: string, json: boolean): { bodyTail: string; end: number } | null {
  if (line.trim() === FENCE) return { bodyTail: "", end: line.length };
  if (!json) return null;
  // JSON strings can't span lines, so string state starts fresh per line.
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inString) {
      if (char === "\\") i += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "`" && line.startsWith(FENCE, i)) {
      const after = i + FENCE.length;
      return { bodyTail: line.slice(0, i), end: line.slice(after).trim() === "" ? line.length : after };
    }
  }
  // A string still open at the end of the line was never valid JSON, so a
  // fence ending that line closes the block after all: the malformed record
  // is skipped and the valid ones before it still render.
  const trimmed = line.trimEnd();
  if (inString && trimmed.endsWith(FENCE)) {
    return { bodyTail: trimmed.slice(0, -FENCE.length), end: line.length };
  }
  return null;
}

/**
 * The info string of an opening fence line, by the completed parser's rule:
 * the text right after the ``` up to trailing whitespace. Leading whitespace
 * stays, so "``` agent-view" names no agent block in either the parser or the
 * streamer.
 */
export function fenceInfo(afterFence: string): string {
  // Scanned from the end: the same rule as a trailing [^\S\r\n]*\r? regex,
  // without that regex's retry at every space of a long run.
  let end = afterFence.length;
  if (afterFence[end - 1] === "\r") end -= 1;
  while (end > 0 && isLineSpace(afterFence[end - 1]!)) end -= 1;
  return afterFence.slice(0, end);
}

/** Whitespace that doesn't end a line. */
function isLineSpace(char: string): boolean {
  return char !== "\r" && char !== "\n" && /\s/.test(char);
}

/**
 * The finder for the first fenced block whose info string is exactly one of
 * `names` (trailing spaces allowed), so an ordinary ```json block never
 * matches. The opening fence starts a line, after optional spaces or tabs (an
 * indented list item), as the streamer requires too; a fence mentioned
 * mid-sentence stays prose. The block ends at the first line
 * {@link closingLine} accepts, read one line at a time, so a ``` in the
 * middle of a line (a code fence inside a JSON string, a JS template literal)
 * never ends it early.
 */
export function fencedBlockFinder(names: readonly string[], json: boolean): BlockFinder {
  const info = names.length === 1 ? names[0]! : `(?:${names.join("|")})`;
  // Groups 1 and 2 are the line break and indentation before the fence: they
  // stay in the prose, so the block starts at the fence itself.
  const open = new RegExp("(^|\\n)([ \\t]*)" + FENCE + info + "[^\\S\\r\\n]*\\r?\\n", "g");
  return (raw) => {
    // A shared regex carries lastIndex between calls.
    open.lastIndex = 0;
    const opening = open.exec(raw);
    if (!opening) return null;
    const bodyStart = opening.index + opening[0].length;
    for (let lineStart = bodyStart; ; ) {
      const newline = raw.indexOf("\n", lineStart);
      const lineEnd = newline === -1 ? raw.length : newline;
      const line = raw.slice(lineStart, lineEnd).replace(/\r$/, "");
      const close = closingLine(line, json);
      if (close) {
        // The lines before the closing one, without the line break that ends
        // them, then whatever part of the closing line is still body.
        const lines = raw.slice(bodyStart, lineStart);
        const body = close.bodyTail === "" ? lines.replace(/\r?\n$/, "") : lines + close.bodyTail;
        const index = opening.index + opening[1]!.length + opening[2]!.length;
        return { index, end: lineStart + close.end, body };
      }
      if (newline === -1) return null;
      lineStart = newline + 1;
    }
  };
}

/**
 * `raw` with the block cut out. Removing a block from the middle of a message
 * leaves the blank lines that bracketed it stacked together, so those collapse
 * to one blank line and the result is trimmed.
 */
export function withoutBlock(raw: string, block: BlockMatch): string {
  return (raw.slice(0, block.index) + raw.slice(block.end))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface ExtractedBlock<T> {
  /** The prose with a decoded block removed, or `raw` unchanged. */
  text: string;
  /** The decoded block, or null when there was none or it didn't decode. */
  value: T | null;
}

/**
 * Finds the first block and decodes its body. A block that `decode` rejects
 * with null stays in the prose as plain text: a slightly raw message beats a
 * dropped one.
 */
export function extractBlock<T>(
  raw: string,
  find: BlockFinder,
  decode: (body: string) => T | null,
): ExtractedBlock<T> {
  const block = find(raw);
  if (!block) return { text: raw, value: null };
  const value = decode(block.body);
  if (value === null) return { text: raw, value: null };
  return { text: withoutBlock(raw, block), value };
}
