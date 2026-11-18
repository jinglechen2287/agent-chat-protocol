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

/**
 * The regex for the first fenced block whose info string is exactly one of
 * `names` (trailing spaces allowed), with the body in group 1, so an ordinary
 * ```json block never matches.
 *
 * - `inline`: the closing fence may follow the last body line directly.
 * - `own-line`: the closing fence must sit alone on its line, so backticks
 *   inside the body (a JS template literal, a ```js example) can't end it.
 */
export function fencedBlockRe(names: readonly string[], close: "inline" | "own-line"): RegExp {
  const info = names.length === 1 ? names[0]! : `(?:${names.join("|")})`;
  const open = "```" + info + "[^\\S\\r\\n]*\\r?\\n([\\s\\S]*?)";
  return new RegExp(
    close === "inline"
      ? open + "\\r?\\n?```"
      : open + "\\r?\\n[ \\t]*```[ \\t]*(?=\\r?\\n|$)",
  );
}

/**
 * `raw` with the matched block cut out. Removing a block from the middle of a
 * message leaves the blank lines that bracketed it stacked together, so those
 * collapse to one blank line and the result is trimmed.
 */
export function withoutMatch(raw: string, match: RegExpExecArray): string {
  return (raw.slice(0, match.index) + raw.slice(match.index + match[0].length))
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
 * Finds the first block `re` matches and decodes its body (group 1). A block
 * that `decode` rejects with null stays in the prose as plain text: a
 * slightly raw message beats a dropped one.
 */
export function extractBlock<T>(
  raw: string,
  re: RegExp,
  decode: (body: string) => T | null,
): ExtractedBlock<T> {
  const match = re.exec(raw);
  if (!match) return { text: raw, value: null };
  const value = decode(match[1] ?? "");
  if (value === null) return { text: raw, value: null };
  return { text: withoutMatch(raw, match), value };
}
