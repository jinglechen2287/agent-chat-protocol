/**
 * Wire decoding: validates a decoded SSE frame back into the typed
 * {@link ChatStreamEvent} union. Unknown event names and malformed payloads
 * map to null, so clients skip them and the stream stays forward-compatible.
 *
 * One decoder per event type, in a table the compiler checks for
 * completeness: a variant added to the union without a decoder here is a type
 * error, not a frame every client silently drops.
 */

import type {
  AttachmentRef,
  BackgroundAgent,
  BackgroundAgentProgress,
  BackgroundAgentStatus,
  ChatStreamEvent,
  McpElicitation,
  McpElicitationAction,
  McpServerStatus,
  PendingMessage,
  AbortReason,
  ToolCallDetail,
  ToolPlanItem,
  ToolTaskMetadata,
} from "./events";
import { threadTitleEvent } from "./events";
import type { QuestionItem } from "./question";
import { validateControls } from "./controls";
import { validateViewComponent, validateViewSpec } from "./view";
import type { SseEvent } from "./sse";
import { definedProps, hasOwn, hasText, isIndex, isNonEmptyString, isRecord, memberOf } from "./guards";

type EventType = ChatStreamEvent["type"];
type EventOf<K extends EventType> = Extract<ChatStreamEvent, { type: K }>;
type Payload = Record<string, unknown>;

const isProvider = memberOf<BackgroundAgent["provider"]>({ claude: true, codex: true });
const isBackgroundAgentStatus = memberOf<BackgroundAgentStatus>({
  pending: true,
  running: true,
  completed: true,
  failed: true,
  interrupted: true,
});
const isMcpServerState = memberOf<McpServerStatus["status"]>({
  connecting: true,
  connected: true,
  failed: true,
  "needs-auth": true,
  disabled: true,
});
const isElicitationAction = memberOf<McpElicitationAction>({ accept: true, decline: true, cancel: true });
const isPendingKind = memberOf<PendingMessage["kind"]>({ steer: true, queue: true });
const isAbortReason = memberOf<AbortReason>({ user: true, timeout: true });

const DECODERS: { [K in EventType]: (d: Payload) => EventOf<K> | null } = {
  session_started: ({ sessionId, protocolVersion }) => {
    if (typeof sessionId !== "string") return null;
    return {
      type: "session_started",
      sessionId,
      ...(typeof protocolVersion === "number" ? { protocolVersion } : {}),
    };
  },
  assistant_text: ({ text }) =>
    typeof text === "string" ? { type: "assistant_text", text } : null,
  assistant_text_delta: ({ index, delta }) =>
    isIndex(index) && typeof delta === "string"
      ? { type: "assistant_text_delta", index, delta }
      : null,
  tool_use: ({ name, summary, details, task, plan }) => {
    if (typeof name !== "string") return null;
    return {
      type: "tool_use",
      name,
      ...definedProps({
        summary: typeof summary === "string" ? summary : undefined,
        details: isToolCallDetails(details) ? details : undefined,
        task: toolTaskMetadata(task),
        plan: toolPlanItems(plan),
      }),
    };
  },
  question: ({ question, options, multi, questions }) => {
    // QuestionSpec requires at least one real option; mirror that invariant.
    if (typeof question !== "string" || !hasRealOptions(options)) return null;
    return {
      type: "question",
      question,
      options,
      ...definedProps({
        multi: typeof multi === "boolean" ? multi : undefined,
        questions: isQuestionList(questions) ? questions : undefined,
      }),
    };
  },
  plan: ({ planMarkdown, title }) =>
    hasText(planMarkdown)
      ? { type: "plan", planMarkdown, title: typeof title === "string" ? title : null }
      : null,
  controls: (d) => {
    const spec = validateControls(d);
    return spec ? { type: "controls", spec } : null;
  },
  view: (d) => {
    const spec = validateViewSpec(d);
    return spec ? { type: "view", spec } : null;
  },
  view_line: ({ index, component }) => {
    if (!isIndex(index)) return null;
    const valid = validateViewComponent(component);
    return valid ? { type: "view_line", index, component: valid } : null;
  },
  html: ({ content }) => (typeof content === "string" ? { type: "html", content } : null),
  html_delta: ({ index, delta }) =>
    isIndex(index) && typeof delta === "string" ? { type: "html_delta", index, delta } : null,
  context_usage: ({ contextTokens, contextWindow, model }) => {
    if (!isIndex(contextTokens)) return null;
    return {
      type: "context_usage",
      contextTokens,
      ...definedProps({
        contextWindow: isIndex(contextWindow) && contextWindow > 0 ? contextWindow : undefined,
        model: hasText(model) ? model : undefined,
      }),
    };
  },
  thread_title: ({ title, overarchingTask, pivotCandidate }) => {
    if (!hasText(title)) return null;
    // `null` passes through as an explicit clear; an unusable value folds
    // to absent (no statement, the reading that leaves client state alone)
    // rather than vetoing the rename the event exists to deliver.
    return threadTitleEvent({
      title,
      overarchingTask: titleStatementValue(overarchingTask),
      pivotCandidate: titleStatementValue(pivotCandidate),
    });
  },
  background_agent_updated: ({ agent }) => {
    const valid = backgroundAgent(agent);
    return valid ? { type: "background_agent_updated", agent: valid } : null;
  },
  mcp_status: ({ servers }) => {
    const valid = listOf(servers, mcpServerStatus);
    return valid ? { type: "mcp_status", servers: valid } : null;
  },
  mcp_elicitation: ({ request }) => {
    const valid = mcpElicitation(request);
    return valid ? { type: "mcp_elicitation", request: valid } : null;
  },
  mcp_elicitation_resolved: ({ id, action }) =>
    isNonEmptyString(id) && isElicitationAction(action)
      ? { type: "mcp_elicitation_resolved", id, action }
      : null,
  pending_messages: ({ revision, messages }) => {
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) return null;
    const valid = listOf(messages, pendingMessage);
    return valid ? { type: "pending_messages", revision, messages: valid } : null;
  },
  user_message: ({ text, steerId, turnId, mode, ts, attachments: rawAttachments }) => {
    const attachments = attachmentRefs(rawAttachments);
    if (attachments === null || typeof text !== "string") return null;
    // Words, files, or both: a steer of files alone has no text.
    if (text.trim() === "" && attachments.length === 0) return null;
    if (!isNonEmptyString(steerId) || !isNonEmptyString(turnId)) return null;
    if (typeof mode !== "string" || typeof ts !== "number" || !Number.isFinite(ts)) return null;
    return {
      type: "user_message",
      text,
      steerId,
      turnId,
      mode,
      ts,
      ...(attachments.length > 0 ? { attachments } : {}),
    };
  },
  stderr: ({ chunk }) => (typeof chunk === "string" ? { type: "stderr", chunk } : null),
  done: ({ exitCode }) => ({
    type: "done",
    exitCode: typeof exitCode === "number" ? exitCode : -1,
  }),
  aborted: ({ reason }) => ({
    type: "aborted",
    ...(isAbortReason(reason) ? { reason } : {}),
  }),
  error: ({ message }) => ({
    type: "error",
    message: typeof message === "string" ? message : "unknown error",
  }),
};

/**
 * Validates a decoded SSE frame into the typed event union. Returns null for
 * unknown event names and malformed payloads; clients skip those frames.
 */
export function mapSseToChatEvent(ev: SseEvent): ChatStreamEvent | null {
  // A string, and an own key: an event named "constructor" must not reach
  // Object(), and a caller's ["done"] must not coerce to "done".
  if (typeof ev.event !== "string" || !hasOwn(DECODERS, ev.event)) return null;
  const decode = DECODERS[ev.event as EventType] as (d: Payload) => ChatStreamEvent | null;
  // A payload that isn't an object reads as having no fields.
  const data = typeof ev.data === "object" && ev.data !== null ? (ev.data as Payload) : {};
  return decode(data);
}

/** Every entry parsed, or null when the value isn't an array or any entry is
 * malformed: a list is accepted whole or not at all. */
function listOf<T>(value: unknown, parse: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  for (const entry of value) {
    const parsed = parse(entry);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

/**
 * Reads optional fields off a record. Absent and `null` both read as absent;
 * a present value the guard rejects reads as absent too but clears `ok`, so
 * the caller can reject the whole payload once at the end.
 */
function optionalFields(record: Payload) {
  let ok = true;
  const parse = <T>(key: string, parser: (value: unknown) => T | null): T | undefined => {
    const value = record[key];
    if (value === undefined || value === null) return undefined;
    const parsed = parser(value);
    if (parsed !== null) return parsed;
    ok = false;
    return undefined;
  };
  return {
    get ok(): boolean {
      return ok;
    },
    parse,
    get: <T>(key: string, guard: (value: unknown) => value is T): T | undefined =>
      parse(key, (value) => (guard(value) ? value : null)),
  };
}

/** Options as `QuestionSpec` holds them: all strings, at least one real. */
function hasRealOptions(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((option) => typeof option === "string")
    && value.some(hasText);
}

/** A form question's list as `QuestionSpec.questions` holds it: at least one
 * question, each a string with at least one real option and, when set, a
 * boolean `multi`. */
function isQuestionList(value: unknown): value is QuestionItem[] {
  return Array.isArray(value) && value.length > 0 && value.every((item: unknown) =>
    isRecord(item)
    && typeof item.question === "string"
    && hasRealOptions(item.options)
    && (item.multi === undefined || typeof item.multi === "boolean"));
}

/** Tri-state title statement: `null` stays an explicit clear, a non-empty
 * string stays a statement, anything else folds to `undefined`: absent, no
 * statement. */
function titleStatementValue(value: unknown): string | null | undefined {
  if (value === null) return null;
  return hasText(value) ? value : undefined;
}

function backgroundAgentProgress(value: unknown): BackgroundAgentProgress | null {
  if (!isRecord(value)) return null;
  const fields = optionalFields(value);
  const progress = definedProps({
    totalTokens: fields.get("totalTokens", isIndex),
    toolUses: fields.get("toolUses", isIndex),
    durationMs: fields.get("durationMs", isIndex),
    lastToolName: fields.get("lastToolName", hasText),
  });
  return fields.ok ? progress : null;
}

function backgroundAgent(value: unknown): BackgroundAgent | null {
  if (!isRecord(value)) return null;
  const { id, provider, status, startedAt, updatedAt } = value;
  if (!hasText(id) || !isProvider(provider) || !isBackgroundAgentStatus(status)) return null;
  if (!isIndex(startedAt) || !isIndex(updatedAt)) return null;

  const fields = optionalFields(value);
  const optional = definedProps({
    parentToolCallId: fields.get("parentToolCallId", hasText),
    description: fields.get("description", hasText),
    agentType: fields.get("agentType", hasText),
    summary: fields.get("summary", hasText),
    error: fields.get("error", hasText),
    progress: fields.parse("progress", backgroundAgentProgress),
    endedAt: fields.get("endedAt", isIndex),
  });
  if (!fields.ok) return null;
  return { id, provider, status, startedAt, updatedAt, ...optional };
}

function pendingMessage(entry: unknown): PendingMessage | null {
  if (!isRecord(entry)) return null;
  const { id, kind, text, mode, ts, from } = entry;
  const attachments = attachmentRefs(entry.attachments);
  if (attachments === null || !isNonEmptyString(id) || !isPendingKind(kind)) return null;
  if (typeof text !== "string" || typeof mode !== "string") return null;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  const sender = from === undefined ? undefined : pendingSender(from);
  if (sender === null) return null;
  return {
    id,
    kind,
    text,
    mode,
    ts,
    ...(sender ? { from: sender } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

function pendingSender(value: unknown): NonNullable<PendingMessage["from"]> | null {
  if (!isRecord(value)) return null;
  const { threadId, title, machineId, machineName } = value;
  if (!isNonEmptyString(threadId) || typeof title !== "string") return null;
  if (machineId !== undefined && typeof machineId !== "string") return null;
  if (machineName !== undefined && typeof machineName !== "string") return null;
  return { threadId, title, ...definedProps({ machineId, machineName }) };
}

/** A message's files: none when absent, null when any is malformed. */
function attachmentRefs(value: unknown): AttachmentRef[] | null {
  return value === undefined ? [] : listOf(value, attachmentRef);
}

function attachmentRef(entry: unknown): AttachmentRef | null {
  if (!isRecord(entry)) return null;
  const { id, name, mimeType, size } = entry;
  if (!isNonEmptyString(id) || !isNonEmptyString(name) || !isNonEmptyString(mimeType)) return null;
  return isIndex(size) ? { id, name, mimeType, size } : null;
}

function mcpServerStatus(entry: unknown): McpServerStatus | null {
  if (!isRecord(entry)) return null;
  const { name, status, error } = entry;
  if (!isNonEmptyString(name) || !isMcpServerState(status)) return null;
  if (error !== undefined && typeof error !== "string") return null;
  return { name, status, ...(error ? { error } : {}) };
}

function mcpElicitation(value: unknown): McpElicitation | null {
  if (!isRecord(value)) return null;
  const { id, serverName, message, mode, requestedSchema, url } = value;
  if (!isNonEmptyString(id) || !isNonEmptyString(serverName)) return null;
  if (typeof message !== "string") return null;
  if (mode === "form") {
    return isRecord(requestedSchema)
      ? { id, serverName, message, mode, requestedSchema }
      : null;
  }
  if (mode === "url") {
    return isNonEmptyString(url) ? { id, serverName, message, mode, url } : null;
  }
  return null;
}

function toolPlanItems(value: unknown): ToolPlanItem[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return listOf(value, toolPlanItem) ?? undefined;
}

function toolPlanItem(item: unknown): ToolPlanItem | null {
  if (!isRecord(item)) return null;
  const { text, status } = item;
  return hasText(text) && hasText(status) ? { text, status } : null;
}

function toolTaskMetadata(value: unknown): ToolTaskMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const textOf = (candidate: unknown): string | undefined =>
    hasText(candidate) ? candidate : undefined;
  const task = definedProps({
    id: textOf(value.id),
    subject: textOf(value.subject),
    status: textOf(value.status),
  });
  return Object.keys(task).length > 0 ? task : undefined;
}

function isToolCallDetails(value: unknown): value is ToolCallDetail[] {
  return Array.isArray(value) && value.every((item) =>
    isRecord(item) && typeof item.label === "string" && typeof item.value === "string");
}
