import { a as valuesEqual, i as validateControls, n as initialControlValues, o as PROTOCOL_VERSION, r as parseControlsBlock, s as isTerminalEvent, t as parseQuestionBlock } from "./question-CSrvam8s.js";
//#region src/sse.ts
/**
* Splits an accumulating SSE text buffer into complete frames. Feed it the
* concatenation of everything received so far that wasn't consumed; it returns
* the parsed frames and the trailing incomplete remainder to carry forward.
*/
function parseSseBuffer(buffer) {
	const events = [];
	const parts = buffer.split(/\r\n\r\n|\n\n|\r\r/);
	const remainder = parts.pop() ?? "";
	for (const block of parts) {
		let event = "message";
		const dataLines = [];
		for (const line of block.split(/\r\n|\n|\r/)) if (line.startsWith("event:")) event = line.slice(6).trim();
		else if (line.startsWith("data:")) {
			const value = line.slice(5);
			dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
		}
		if (dataLines.length === 0) continue;
		let data = dataLines.join("\n");
		try {
			data = JSON.parse(dataLines.join("\n"));
		} catch {}
		events.push({
			event,
			data
		});
	}
	return {
		events,
		remainder
	};
}
/**
* Validates a decoded SSE frame into the typed event union. Returns null for
* unknown event names and malformed payloads — clients skip those frames.
*/
function mapSseToChatEvent(ev) {
	const d = ev.data;
	const get = (k) => typeof d === "object" && d !== null ? d[k] : void 0;
	switch (ev.event) {
		case "session_started": {
			const sessionId = get("sessionId");
			if (typeof sessionId !== "string") return null;
			const protocolVersion = get("protocolVersion");
			return {
				type: "session_started",
				sessionId,
				...typeof protocolVersion === "number" ? { protocolVersion } : {}
			};
		}
		case "assistant_text": {
			const text = get("text");
			if (typeof text === "string") return {
				type: "assistant_text",
				text
			};
			return null;
		}
		case "tool_use": {
			const name = get("name");
			if (typeof name !== "string") return null;
			const summary = get("summary");
			const rawDetails = get("details");
			const details = isToolCallDetails(rawDetails) ? rawDetails : void 0;
			const task = toolTaskMetadata(get("task"));
			const plan = toolPlanItems(get("plan"));
			return {
				type: "tool_use",
				name,
				...typeof summary === "string" ? { summary } : {},
				...details ? { details } : {},
				...task ? { task } : {},
				...plan ? { plan } : {}
			};
		}
		case "question": {
			const question = get("question");
			const options = get("options");
			if (typeof question === "string" && Array.isArray(options) && options.every((o) => typeof o === "string")) return {
				type: "question",
				question,
				options
			};
			return null;
		}
		case "controls": {
			const spec = validateControls(d);
			if (spec) return {
				type: "controls",
				spec
			};
			return null;
		}
		case "context_usage": {
			const contextTokens = get("contextTokens");
			if (!Number.isSafeInteger(contextTokens) || contextTokens < 0) return null;
			const contextWindow = get("contextWindow");
			const model = get("model");
			return {
				type: "context_usage",
				contextTokens,
				...Number.isSafeInteger(contextWindow) && contextWindow > 0 ? { contextWindow } : {},
				...typeof model === "string" && model.trim() !== "" ? { model } : {}
			};
		}
		case "thread_title": {
			const title = get("title");
			return typeof title === "string" && title.trim() !== "" ? {
				type: "thread_title",
				title
			} : null;
		}
		case "background_agent_updated": {
			const agent = backgroundAgent(get("agent"));
			return agent ? {
				type: "background_agent_updated",
				agent
			} : null;
		}
		case "stderr": {
			const chunk = get("chunk");
			if (typeof chunk === "string") return {
				type: "stderr",
				chunk
			};
			return null;
		}
		case "done": {
			const exitCode = get("exitCode");
			return {
				type: "done",
				exitCode: typeof exitCode === "number" ? exitCode : -1
			};
		}
		case "aborted": {
			const reason = get("reason");
			return {
				type: "aborted",
				...reason === "user" || reason === "timeout" ? { reason } : {}
			};
		}
		case "error": {
			const message = get("message");
			return {
				type: "error",
				message: typeof message === "string" ? message : "unknown error"
			};
		}
		default: return null;
	}
}
function optionalNonEmptyString(record, key) {
	const value = record[key];
	if (value === void 0 || value === null) return void 0;
	return typeof value === "string" && value.trim() !== "" ? value : null;
}
function optionalNonNegativeInteger(record, key) {
	const value = record[key];
	if (value === void 0 || value === null) return void 0;
	return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function backgroundAgentProgress(value) {
	if (value === void 0 || value === null) return void 0;
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value;
	const totalTokens = optionalNonNegativeInteger(record, "totalTokens");
	const toolUses = optionalNonNegativeInteger(record, "toolUses");
	const durationMs = optionalNonNegativeInteger(record, "durationMs");
	const lastToolName = optionalNonEmptyString(record, "lastToolName");
	if (totalTokens === null || toolUses === null || durationMs === null || lastToolName === null) return null;
	return {
		...totalTokens !== void 0 ? { totalTokens } : {},
		...toolUses !== void 0 ? { toolUses } : {},
		...durationMs !== void 0 ? { durationMs } : {},
		...lastToolName !== void 0 ? { lastToolName } : {}
	};
}
function backgroundAgent(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value;
	const id = optionalNonEmptyString(record, "id");
	const provider = record.provider;
	const status = record.status;
	const startedAt = optionalNonNegativeInteger(record, "startedAt");
	const updatedAt = optionalNonNegativeInteger(record, "updatedAt");
	if (!id || provider !== "claude" && provider !== "codex" || ![
		"pending",
		"running",
		"completed",
		"failed",
		"interrupted"
	].includes(typeof status === "string" ? status : "") || startedAt === void 0 || startedAt === null || updatedAt === void 0 || updatedAt === null) return null;
	const parentToolCallId = optionalNonEmptyString(record, "parentToolCallId");
	const description = optionalNonEmptyString(record, "description");
	const agentType = optionalNonEmptyString(record, "agentType");
	const summary = optionalNonEmptyString(record, "summary");
	const error = optionalNonEmptyString(record, "error");
	const endedAt = optionalNonNegativeInteger(record, "endedAt");
	const progress = backgroundAgentProgress(record.progress);
	if (parentToolCallId === null || description === null || agentType === null || summary === null || error === null || endedAt === null || progress === null) return null;
	return {
		id,
		provider,
		status,
		startedAt,
		updatedAt,
		...parentToolCallId !== void 0 ? { parentToolCallId } : {},
		...description !== void 0 ? { description } : {},
		...agentType !== void 0 ? { agentType } : {},
		...summary !== void 0 ? { summary } : {},
		...error !== void 0 ? { error } : {},
		...progress !== void 0 ? { progress } : {},
		...endedAt !== void 0 ? { endedAt } : {}
	};
}
function toolPlanItems(value) {
	if (!Array.isArray(value) || value.length === 0) return void 0;
	const items = [];
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) return void 0;
		const record = item;
		if (typeof record.text !== "string" || record.text.trim() === "" || typeof record.status !== "string" || record.status.trim() === "") return;
		items.push({
			text: record.text,
			status: record.status
		});
	}
	return items;
}
function toolTaskMetadata(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
	const record = value;
	const field = (key) => {
		const candidate = record[key];
		return typeof candidate === "string" && candidate.trim() !== "" ? candidate : void 0;
	};
	const id = field("id");
	const subject = field("subject");
	const status = field("status");
	const task = {
		...id ? { id } : {},
		...subject ? { subject } : {},
		...status ? { status } : {}
	};
	return Object.keys(task).length > 0 ? task : void 0;
}
/** Converts a typed event into its wire frame: the `type` discriminant becomes
* the SSE event name; the rest becomes the data payload. The `controls` spec
* is sent directly as the payload (not wrapped in `{spec}`). */
function toSseEvent(ev) {
	if (ev.type === "controls") return {
		event: "controls",
		data: ev.spec
	};
	const { type, ...data } = ev;
	return {
		event: type,
		data
	};
}
/** Formats one SSE frame as wire text: `event: <name>\ndata: <json>\n\n`. */
function formatSseEvent(ev) {
	return `event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`;
}
/** `formatSseEvent(toSseEvent(ev))` — one typed event to one wire chunk. */
function encodeChatEvent(ev) {
	return formatSseEvent(toSseEvent(ev));
}
async function consumeSseResponse(res, onEvent, options = {}) {
	if (!res.ok || !res.body) {
		const text = await res.text().catch(() => "");
		throw new Error(`chat stream request failed (${res.status}): ${text}`);
	}
	const mapEvent = options.mapEvent ?? mapSseToChatEvent;
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
function isToolCallDetails(value) {
	return Array.isArray(value) && value.every((item) => item !== null && typeof item === "object" && !Array.isArray(item) && typeof item.label === "string" && typeof item.value === "string");
}
//#endregion
//#region src/prompt.ts
/**
* The emit side of the generative-UI grammar: the prompt section that teaches
* an agent when and how to end a message with an ```agent-question``` block.
* Apps append it to their system prompt (Claude `--append-system-prompt`,
* Codex `developerInstructions`) so the grammar survives long conversations
* where early user messages get compacted away.
*
* Kept in this package alongside the parse-side (parseQuestionBlock) so the
* two can't drift.
*
* Controls emission guidance is app-specific — what the controls tune (CSS in
* carve's case) is an app extension, so each app authors its own controls
* prompt section, using {@link CONTROLS_BLOCK_NAME} as the fence and keeping
* the core widget schema this package validates.
*/
const QUESTION_BLOCK_NAME = "agent-question";
const CONTROLS_BLOCK_NAME = "agent-controls";
/** Accepted by the parsers during migration; do not teach agents to emit. */
const LEGACY_QUESTION_BLOCK_NAME = "carve-question";
/** Accepted by the parsers during migration; do not teach agents to emit. */
const LEGACY_CONTROLS_BLOCK_NAME = "carve-controls";
/** Teaches the clarifying-question block. Framework- and DOM-agnostic. */
const QUESTION_PROMPT = [
	"- If the request is genuinely ambiguous (multiple reasonable interpretations), ask one short clarifying question instead of guessing, and don't make edits that turn. Otherwise apply the change directly.",
	"- When a clarifying question has a small, fixed set of answers, end your message with a question block so the user can answer in one click:",
	`  \`\`\`${QUESTION_BLOCK_NAME}`,
	"  {\"question\": \"Short question?\", \"options\": [\"First choice\", \"Second choice\"]}",
	"  ```",
	"  Emit at most one such block, as the very last thing in the message, with 2–6 short option labels. The user's pick (or a typed reply) arrives as the next message. If the answer isn't a small fixed set of choices, just ask in plain text."
].join("\n");
//#endregion
export { CONTROLS_BLOCK_NAME, LEGACY_CONTROLS_BLOCK_NAME, LEGACY_QUESTION_BLOCK_NAME, PROTOCOL_VERSION, QUESTION_BLOCK_NAME, QUESTION_PROMPT, consumeSseResponse, encodeChatEvent, formatSseEvent, initialControlValues, isTerminalEvent, mapSseToChatEvent, parseControlsBlock, parseQuestionBlock, parseSseBuffer, toSseEvent, validateControls, valuesEqual };

//# sourceMappingURL=index.js.map