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

/**
 * The finder for the first fenced block whose info string is exactly one of
 * `names` (trailing spaces allowed), so an ordinary ```json block never
 * matches.
 *
 * - `inline`: the closing fence may follow the last body line directly.
 * - `own-line`: the closing fence must sit alone on its line, so backticks
 *   inside the body (a JS template literal, a ```js example) can't end it.
 */
export function fencedPatternFinder(
  names: readonly string[],
  close: "inline" | "own-line",
): BlockFinder {
  const info = names.length === 1 ? names[0]! : `(?:${names.join("|")})`;
  return splitPatternFinder(
    new RegExp("```" + info + "[^\\S\\r\\n]*\\r?\\n", "g"),
    new RegExp(
      close === "inline"
        ? "([\\s\\S]*?)\\r?\\n?```"
        : "([\\s\\S]*?)\\r?\\n[ \\t]*```[ \\t]*(?=\\r?\\n|$)",
      "y",
    ),
  );
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
