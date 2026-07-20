/**
 * SSE codec for the chat event stream — both directions.
 *
 * Server side: `toSseEvent` / `formatSseEvent` / `encodeChatEvent` turn a
 * typed {@link ChatStreamEvent} into a wire frame. Client side:
 * `parseSseBuffer` splits a byte stream into frames and `mapSseToChatEvent`
 * validates each frame back into the typed union (unknown or malformed frames
 * map to null — clients skip them, keeping the stream forward-compatible).
 *
 * SSE is the first transport, not the only possible one — the typed union is
 * the contract; this module is one encoding of it.
 */

import type {
  BackgroundAgent,
  BackgroundAgentProgress,
  ChatStreamEvent,
  ToolCallDetail,
  ToolPlanItem,
  ToolTaskMetadata,
} from "./events";
import { validateControls } from "./controls";

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
  // them); accept all three for framing and within blocks.
  const parts = buffer.split(/\r\n\r\n|\n\n|\r\r/);
  const remainder = parts.pop() ?? "";
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
    let data: unknown = dataLines.join("\n");
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      // leave as string
    }
    events.push({ event, data });
  }
  return { events, remainder };
}

/**
 * Validates a decoded SSE frame into the typed event union. Returns null for
 * unknown event names and malformed payloads — clients skip those frames.
 */
export function mapSseToChatEvent(ev: SseEvent): ChatStreamEvent | null {
  const d = ev.data as Record<string, unknown> | string | undefined;
  const get = (k: string): unknown =>
    typeof d === "object" && d !== null ? d[k] : undefined;

  switch (ev.event) {
    case "session_started": {
      const sessionId = get("sessionId");
      if (typeof sessionId !== "string") return null;
      const protocolVersion = get("protocolVersion");
      return {
        type: "session_started",
        sessionId,
        ...(typeof protocolVersion === "number" ? { protocolVersion } : {}),
      };
    }
    case "assistant_text": {
      const text = get("text");
      if (typeof text === "string") return { type: "assistant_text", text };
      return null;
    }
    case "tool_use": {
      const name = get("name");
      if (typeof name !== "string") return null;
      const summary = get("summary");
      const rawDetails = get("details");
      const details = isToolCallDetails(rawDetails) ? rawDetails : undefined;
      const task = toolTaskMetadata(get("task"));
      const plan = toolPlanItems(get("plan"));
      return {
        type: "tool_use",
        name,
        ...(typeof summary === "string" ? { summary } : {}),
        ...(details ? { details } : {}),
        ...(task ? { task } : {}),
        ...(plan ? { plan } : {}),
      };
    }
    case "question": {
      const question = get("question");
      const options = get("options");
      if (
        typeof question === "string" &&
        Array.isArray(options) &&
        options.every((o) => typeof o === "string")
      ) {
        return { type: "question", question, options };
      }
      return null;
    }
    case "controls": {
      const spec = validateControls(d);
      if (spec) return { type: "controls", spec };
      return null;
    }
    case "context_usage": {
      const contextTokens = get("contextTokens");
      if (!Number.isSafeInteger(contextTokens) || (contextTokens as number) < 0) {
        return null;
      }
      const contextWindow = get("contextWindow");
      const model = get("model");
      return {
        type: "context_usage",
        contextTokens: contextTokens as number,
        ...(Number.isSafeInteger(contextWindow) && (contextWindow as number) > 0
          ? { contextWindow: contextWindow as number }
          : {}),
        ...(typeof model === "string" && model.trim() !== "" ? { model } : {}),
      };
    }
    case "thread_title": {
      const title = get("title");
      return typeof title === "string" && title.trim() !== ""
        ? { type: "thread_title", title }
        : null;
    }
    case "background_agent_updated": {
      const agent = backgroundAgent(get("agent"));
      return agent ? { type: "background_agent_updated", agent } : null;
    }
    case "stderr": {
      const chunk = get("chunk");
      if (typeof chunk === "string") return { type: "stderr", chunk };
      return null;
    }
    case "done": {
      const exitCode = get("exitCode");
      return {
        type: "done",
        exitCode: typeof exitCode === "number" ? exitCode : -1,
      };
    }
    case "aborted": {
      const reason = get("reason");
      return {
        type: "aborted",
        ...(reason === "user" || reason === "timeout" ? { reason } : {}),
      };
    }
    case "error": {
      const message = get("message");
      return {
        type: "error",
        message: typeof message === "string" ? message : "unknown error",
      };
    }
    default:
      return null;
  }
}

function optionalNonEmptyString(
  record: Record<string, unknown>,
  key: string,
): string | undefined | null {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function optionalNonNegativeInteger(
  record: Record<string, unknown>,
  key: string,
): number | undefined | null {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
}

function backgroundAgentProgress(value: unknown): BackgroundAgentProgress | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const totalTokens = optionalNonNegativeInteger(record, "totalTokens");
  const toolUses = optionalNonNegativeInteger(record, "toolUses");
  const durationMs = optionalNonNegativeInteger(record, "durationMs");
  const lastToolName = optionalNonEmptyString(record, "lastToolName");
  if (
    totalTokens === null
    || toolUses === null
    || durationMs === null
    || lastToolName === null
  ) return null;
  return {
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(toolUses !== undefined ? { toolUses } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(lastToolName !== undefined ? { lastToolName } : {}),
  };
}

function backgroundAgent(value: unknown): BackgroundAgent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = optionalNonEmptyString(record, "id");
  const provider = record.provider;
  const status = record.status;
  const startedAt = optionalNonNegativeInteger(record, "startedAt");
  const updatedAt = optionalNonNegativeInteger(record, "updatedAt");
  if (
    !id
    || (provider !== "claude" && provider !== "codex")
    || !["pending", "running", "completed", "failed", "interrupted"].includes(
      typeof status === "string" ? status : "",
    )
    || startedAt === undefined
    || startedAt === null
    || updatedAt === undefined
    || updatedAt === null
  ) return null;

  const parentToolCallId = optionalNonEmptyString(record, "parentToolCallId");
  const description = optionalNonEmptyString(record, "description");
  const agentType = optionalNonEmptyString(record, "agentType");
  const summary = optionalNonEmptyString(record, "summary");
  const error = optionalNonEmptyString(record, "error");
  const endedAt = optionalNonNegativeInteger(record, "endedAt");
  const progress = backgroundAgentProgress(record.progress);
  if (
    parentToolCallId === null
    || description === null
    || agentType === null
    || summary === null
    || error === null
    || endedAt === null
    || progress === null
  ) return null;

  return {
    id,
    provider,
    status: status as BackgroundAgent["status"],
    startedAt,
    updatedAt,
    ...(parentToolCallId !== undefined ? { parentToolCallId } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(agentType !== undefined ? { agentType } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(progress !== undefined ? { progress } : {}),
    ...(endedAt !== undefined ? { endedAt } : {}),
  };
}

function toolPlanItems(value: unknown): ToolPlanItem[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const items: ToolPlanItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
    const record = item as Record<string, unknown>;
    if (
      typeof record.text !== "string" || record.text.trim() === ""
      || typeof record.status !== "string" || record.status.trim() === ""
    ) {
      return undefined;
    }
    items.push({ text: record.text, status: record.status });
  }
  return items;
}

function toolTaskMetadata(value: unknown): ToolTaskMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const field = (key: string): string | undefined => {
    const candidate = record[key];
    return typeof candidate === "string" && candidate.trim() !== ""
      ? candidate
      : undefined;
  };
  const id = field("id");
  const subject = field("subject");
  const status = field("status");
  const task = {
    ...(id ? { id } : {}),
    ...(subject ? { subject } : {}),
    ...(status ? { status } : {}),
  };
  return Object.keys(task).length > 0 ? task : undefined;
}

/** Converts a typed event into its wire frame: the `type` discriminant becomes
 * the SSE event name; the rest becomes the data payload. The `controls` spec
 * is sent directly as the payload (not wrapped in `{spec}`). */
export function toSseEvent(ev: ChatStreamEvent): SseEvent {
  if (ev.type === "controls") return { event: "controls", data: ev.spec };
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
}

function isToolCallDetails(value: unknown): value is ToolCallDetail[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        typeof (item as Record<string, unknown>).label === "string" &&
        typeof (item as Record<string, unknown>).value === "string",
    )
  );
}
