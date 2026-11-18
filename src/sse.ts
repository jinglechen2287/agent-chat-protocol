/**
 * SSE codec for the chat event stream — both directions.
 *
 * Server side: `toSseEvent` / `formatSseEvent` / `encodeChatEvent` turn a
 * typed {@link ChatStreamEvent} into a wire frame. Client side:
 * `parseSseBuffer` splits a byte stream into frames, and `mapSseToChatEvent`
 * (in decode.ts) validates each frame back into the typed union.
 *
 * SSE is the first transport, not the only possible one — the typed union is
 * the contract; this module is one encoding of it.
 */

import type { ChatStreamEvent } from "./events";
import { mapSseToChatEvent } from "./decode";

/** One decoded SSE frame: the `event:` name and the JSON-parsed `data:`
 * payload (left as a string when it isn't valid JSON). */
export interface SseEvent {
  event: string;
  data: unknown;
}

export interface SseParseResult {
  events: SseEvent[];
  remainder: string;
}

/**
 * Splits an accumulating SSE text buffer into complete frames. Feed it the
 * concatenation of everything received so far that wasn't consumed; it returns
 * the parsed frames and the trailing incomplete remainder to carry forward.
 */
export function parseSseBuffer(buffer: string): SseParseResult {
  const events: SseEvent[] = [];
  // SSE line endings may be LF, CRLF, or CR (per spec, and proxies rewrite
  // them); each line's terminator is independent, so a frame boundary is any
  // two consecutive terminators, mixed or not. A trailing bare CR may be the
  // first half of a CRLF split across chunks — hold it back so it can't close
  // a frame prematurely.
  const holdCr = buffer.endsWith("\r");
  const splittable = holdCr ? buffer.slice(0, -1) : buffer;
  // `\r(?!\n)` keeps a CRLF pair atomic — without the lookahead, backtracking
  // could split one CRLF into two terminators and cut a frame mid-line.
  const parts = splittable.split(/(?:\r\n|\r(?!\n)|\n){2}/);
  const remainder = (parts.pop() ?? "") + (holdCr ? "\r" : "");
  for (const block of parts) {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\r\n|\n|\r/)) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        // Per spec only the single optional space after the colon is
        // stripped; all other payload whitespace is meaningful.
        const value = line.slice("data:".length);
        dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
      }
    }
    if (dataLines.length === 0) continue;
    const text = dataLines.join("\n");
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // leave as string
    }
    events.push({ event, data });
  }
  return { events, remainder };
}

/** Converts a typed event into its wire frame: the `type` discriminant becomes
 * the SSE event name; the rest becomes the data payload. The `controls` and
 * `view` specs are sent directly as the payload (not wrapped in `{spec}`). */
export function toSseEvent(ev: ChatStreamEvent): SseEvent {
  if (ev.type === "controls") return { event: "controls", data: ev.spec };
  if (ev.type === "view") return { event: "view", data: ev.spec };
  const { type, ...data } = ev;
  return { event: type, data };
}

/** Formats one SSE frame as wire text: `event: <name>\ndata: <json>\n\n`. */
export function formatSseEvent(ev: SseEvent): string {
  return `event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`;
}

/** `formatSseEvent(toSseEvent(ev))` — one typed event to one wire chunk. */
export function encodeChatEvent(ev: ChatStreamEvent): string {
  return formatSseEvent(toSseEvent(ev));
}

export interface ConsumeSseOptions<TEvent = ChatStreamEvent> {
  /**
   * Overrides the frame→event mapping (default {@link mapSseToChatEvent}).
   * Apps that extend the controls spec supply a mapper that re-validates
   * `controls` payloads with their own validator; the default mapper
   * canonicalizes controls to the core widgets-only spec, dropping extension
   * fields.
   */
  mapEvent?: (ev: SseEvent) => TEvent | null;
}

/**
 * Reads a fetch Response body as an SSE stream, mapping each frame into a
 * typed event. Resolves when the stream ends; rejects on a non-OK response.
 * Frames that don't map (unknown names, malformed payloads) are skipped.
 * The overloads tie a narrowed event type to the presence of a custom
 * `mapEvent` — without one, events are the default union.
 */
export async function consumeSseResponse(
  res: Response,
  onEvent: (e: ChatStreamEvent) => void,
  options?: ConsumeSseOptions<ChatStreamEvent>,
): Promise<void>;
export async function consumeSseResponse<TEvent>(
  res: Response,
  onEvent: (e: TEvent) => void,
  options: ConsumeSseOptions<TEvent> & {
    mapEvent: (ev: SseEvent) => TEvent | null;
  },
): Promise<void>;
export async function consumeSseResponse<TEvent = ChatStreamEvent>(
  res: Response,
  onEvent: (e: TEvent) => void,
  options: ConsumeSseOptions<TEvent> = {},
): Promise<void> {
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`chat stream request failed (${res.status}): ${text}`);
  }

  const mapEvent =
    options.mapEvent ?? (mapSseToChatEvent as (ev: SseEvent) => TEvent | null);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const result = parseSseBuffer(buffer);
      buffer = result.remainder;
      for (const ev of result.events) {
        const mapped = mapEvent(ev);
        if (mapped) onEvent(mapped);
      }
    }
  } catch (err) {
    // A throwing mapper or handler ends the read; close the connection
    // instead of leaving it open. Not awaited, so a cancel that never
    // settles cannot hold back the caller's rejection.
    reader.cancel(err).catch(() => {});
    throw err;
  } finally {
    reader.releaseLock();
  }
}
