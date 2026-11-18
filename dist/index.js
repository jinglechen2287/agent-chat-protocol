import { A as isNonEmptyString, B as fallbackChatTitle, C as QUESTION_BLOCK_NAME, D as hasOwn, E as definedProps, F as threadTitleEvent, G as truncateChatTitle, H as normalizeTaskSummary, I as threadTitleSnapshotEvent, L as CHAT_TITLE_MAX_LENGTH, M as memberOf, N as PROTOCOL_VERSION, O as hasText, P as isTerminalEvent, R as CHAT_TITLE_RECENT_MESSAGE_LIMIT, S as PLAN_PROMPT, T as VIEW_BLOCK_NAME, V as normalizeChatTitle, W as toChatTitleMessages, _ as CHAT_PROMPT, a as formatQuestionAnswers, b as LEGACY_CONTROLS_BLOCK_NAME, c as VIEW_PROMPT, d as validateViewSpec, f as initialControlValues, g as BUILD_PROMPT, h as valuesEqual, i as parseProposedPlan, j as isRecord, k as isIndex, l as parseViewBlock, m as validateControls, n as parseHtmlBlock, o as parseQuestionBlock, p as parseControlsBlock, r as parseHtmlFrameMessage, s as VIEW_CATALOG, t as HTML_SEND_MAX, u as validateViewComponent, v as CONTROLS_BLOCK_NAME, w as QUESTION_PROMPT, x as LEGACY_QUESTION_BLOCK_NAME, y as HTML_BLOCK_NAME, z as CHAT_TITLE_TASK_MAX_LENGTH } from "./html-CIqNcN5j.js";
// src/decode.ts
const isProvider = memberOf({
	claude: true,
	codex: true
});
const isBackgroundAgentStatus = memberOf({
	pending: true,
	running: true,
	completed: true,
	failed: true,
	interrupted: true
});
const isMcpServerState = memberOf({
	connecting: true,
	connected: true,
	failed: true,
	"needs-auth": true,
	disabled: true
});
const isElicitationAction = memberOf({
	accept: true,
	decline: true,
	cancel: true
});
const isPendingKind = memberOf({
	steer: true,
	queue: true
});
const isAbortReason = memberOf({
	user: true,
	timeout: true
});
const DECODERS = {
	session_started: ({ sessionId, protocolVersion }) => {
		if (typeof sessionId !== "string") return null;
		return {
			type: "session_started",
			sessionId,
			...typeof protocolVersion === "number" ? { protocolVersion } : {}
		};
	},
	assistant_text: ({ text }) => typeof text === "string" ? {
		type: "assistant_text",
		text
	} : null,
	assistant_text_delta: ({ index, delta }) => isIndex(index) && typeof delta === "string" ? {
		type: "assistant_text_delta",
		index,
		delta
	} : null,
	tool_use: ({ name, summary, details, task, plan }) => {
		if (typeof name !== "string") return null;
		return {
			type: "tool_use",
			name,
			...definedProps({
				summary: typeof summary === "string" ? summary : void 0,
				details: isToolCallDetails(details) ? details : void 0,
				task: toolTaskMetadata(task),
				plan: toolPlanItems(plan)
			})
		};
	},
	question: ({ question, options, multi, questions }) => {
		if (typeof question !== "string" || !hasRealOptions(options)) return null;
		return {
			type: "question",
			question,
			options,
			...definedProps({
				multi: typeof multi === "boolean" ? multi : void 0,
				questions: isQuestionList(questions) ? questions : void 0
			})
		};
	},
	plan: ({ planMarkdown, title }) => hasText(planMarkdown) ? {
		type: "plan",
		planMarkdown,
		title: typeof title === "string" ? title : null
	} : null,
	controls: (d) => {
		const spec = validateControls(d);
		return spec ? {
			type: "controls",
			spec
		} : null;
	},
	view: (d) => {
		const spec = validateViewSpec(d);
		return spec ? {
			type: "view",
			spec
		} : null;
	},
	view_line: ({ index, component }) => {
		if (!isIndex(index)) return null;
		const valid = validateViewComponent(component);
		return valid ? {
			type: "view_line",
			index,
			component: valid
		} : null;
	},
	html: ({ content }) => typeof content === "string" ? {
		type: "html",
		content
	} : null,
	html_delta: ({ index, delta }) => isIndex(index) && typeof delta === "string" ? {
		type: "html_delta",
		index,
		delta
	} : null,
	context_usage: ({ contextTokens, contextWindow, model }) => {
		if (!isIndex(contextTokens)) return null;
		return {
			type: "context_usage",
			contextTokens,
			...definedProps({
				contextWindow: isIndex(contextWindow) && contextWindow > 0 ? contextWindow : void 0,
				model: hasText(model) ? model : void 0
			})
		};
	},
	thread_title: ({ title, overarchingTask, pivotCandidate }) => {
		if (!hasText(title)) return null;
		return threadTitleEvent({
			title,
			overarchingTask: titleStatementValue(overarchingTask),
			pivotCandidate: titleStatementValue(pivotCandidate)
		});
	},
	background_agent_updated: ({ agent }) => {
		const valid = backgroundAgent(agent);
		return valid ? {
			type: "background_agent_updated",
			agent: valid
		} : null;
	},
	mcp_status: ({ servers }) => {
		const valid = listOf(servers, mcpServerStatus);
		return valid ? {
			type: "mcp_status",
			servers: valid
		} : null;
	},
	mcp_elicitation: ({ request }) => {
		const valid = mcpElicitation(request);
		return valid ? {
			type: "mcp_elicitation",
			request: valid
		} : null;
	},
	mcp_elicitation_resolved: ({ id, action }) => isNonEmptyString(id) && isElicitationAction(action) ? {
		type: "mcp_elicitation_resolved",
		id,
		action
	} : null,
	pending_messages: ({ revision, messages }) => {
		if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) return null;
		const valid = listOf(messages, pendingMessage);
		return valid ? {
			type: "pending_messages",
			revision,
			messages: valid
		} : null;
	},
	user_message: ({ text, steerId, turnId, mode, ts, attachments: rawAttachments }) => {
		const attachments = attachmentRefs(rawAttachments);
		if (attachments === null || typeof text !== "string") return null;
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
			...attachments.length > 0 ? { attachments } : {}
		};
	},
	stderr: ({ chunk }) => typeof chunk === "string" ? {
		type: "stderr",
		chunk
	} : null,
	done: ({ exitCode }) => ({
		type: "done",
		exitCode: typeof exitCode === "number" ? exitCode : -1
	}),
	aborted: ({ reason }) => ({
		type: "aborted",
		...isAbortReason(reason) ? { reason } : {}
	}),
	error: ({ message }) => ({
		type: "error",
		message: typeof message === "string" ? message : "unknown error"
	})
};
/**
* Validates a decoded SSE frame into the typed event union. Returns null for
* unknown event names and malformed payloads; clients skip those frames.
*/
function mapSseToChatEvent(ev) {
	if (typeof ev.event !== "string" || !hasOwn(DECODERS, ev.event)) return null;
	const decode = DECODERS[ev.event];
	return decode(typeof ev.data === "object" && ev.data !== null ? ev.data : {});
}
/** Every entry parsed, or null when the value isn't an array or any entry is
* malformed: a list is accepted whole or not at all. */
function listOf(value, parse) {
	if (!Array.isArray(value)) return null;
	const out = [];
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
function optionalFields(record) {
	let ok = true;
	const parse = (key, parser) => {
		const value = record[key];
		if (value === void 0 || value === null) return void 0;
		const parsed = parser(value);
		if (parsed !== null) return parsed;
		ok = false;
	};
	return {
		get ok() {
			return ok;
		},
		parse,
		get: (key, guard) => parse(key, (value) => guard(value) ? value : null)
	};
}
/** Options as `QuestionSpec` holds them: all strings, at least one real. */
function hasRealOptions(value) {
	return Array.isArray(value) && value.every((option) => typeof option === "string") && value.some(hasText);
}
/** A form question's list as `QuestionSpec.questions` holds it: at least one
* question, each a string with at least one real option and, when set, a
* boolean `multi`. */
function isQuestionList(value) {
	return Array.isArray(value) && value.length > 0 && value.every((item) => isRecord(item) && typeof item.question === "string" && hasRealOptions(item.options) && (item.multi === void 0 || typeof item.multi === "boolean"));
}
/** Tri-state title statement: `null` stays an explicit clear, a non-empty
* string stays a statement, anything else folds to `undefined`: absent, no
* statement. */
function titleStatementValue(value) {
	if (value === null) return null;
	return hasText(value) ? value : void 0;
}
function backgroundAgentProgress(value) {
	if (!isRecord(value)) return null;
	const fields = optionalFields(value);
	const progress = definedProps({
		totalTokens: fields.get("totalTokens", isIndex),
		toolUses: fields.get("toolUses", isIndex),
		durationMs: fields.get("durationMs", isIndex),
		lastToolName: fields.get("lastToolName", hasText)
	});
	return fields.ok ? progress : null;
}
function backgroundAgent(value) {
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
		endedAt: fields.get("endedAt", isIndex)
	});
	if (!fields.ok) return null;
	return {
		id,
		provider,
		status,
		startedAt,
		updatedAt,
		...optional
	};
}
function pendingMessage(entry) {
	if (!isRecord(entry)) return null;
	const { id, kind, text, mode, ts, from } = entry;
	const attachments = attachmentRefs(entry.attachments);
	if (attachments === null || !isNonEmptyString(id) || !isPendingKind(kind)) return null;
	if (typeof text !== "string" || typeof mode !== "string") return null;
	if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
	const sender = from === void 0 ? void 0 : pendingSender(from);
	if (sender === null) return null;
	return {
		id,
		kind,
		text,
		mode,
		ts,
		...sender ? { from: sender } : {},
		...attachments.length > 0 ? { attachments } : {}
	};
}
function pendingSender(value) {
	if (!isRecord(value)) return null;
	const { threadId, title, machineId, machineName } = value;
	if (!isNonEmptyString(threadId) || typeof title !== "string") return null;
	if (machineId !== void 0 && typeof machineId !== "string") return null;
	if (machineName !== void 0 && typeof machineName !== "string") return null;
	return {
		threadId,
		title,
		...definedProps({
			machineId,
			machineName
		})
	};
}
/** A message's files: none when absent, null when any is malformed. */
function attachmentRefs(value) {
	return value === void 0 ? [] : listOf(value, attachmentRef);
}
function attachmentRef(entry) {
	if (!isRecord(entry)) return null;
	const { id, name, mimeType, size } = entry;
	if (!isNonEmptyString(id) || !isNonEmptyString(name) || !isNonEmptyString(mimeType)) return null;
	return isIndex(size) ? {
		id,
		name,
		mimeType,
		size
	} : null;
}
function mcpServerStatus(entry) {
	if (!isRecord(entry)) return null;
	const { name, status, error } = entry;
	if (!isNonEmptyString(name) || !isMcpServerState(status)) return null;
	if (error !== void 0 && typeof error !== "string") return null;
	return {
		name,
		status,
		...error ? { error } : {}
	};
}
function mcpElicitation(value) {
	if (!isRecord(value)) return null;
	const { id, serverName, message, mode, requestedSchema, url } = value;
	if (!isNonEmptyString(id) || !isNonEmptyString(serverName)) return null;
	if (typeof message !== "string") return null;
	if (mode === "form") return isRecord(requestedSchema) ? {
		id,
		serverName,
		message,
		mode,
		requestedSchema
	} : null;
	if (mode === "url") return isNonEmptyString(url) ? {
		id,
		serverName,
		message,
		mode,
		url
	} : null;
	return null;
}
function toolPlanItems(value) {
	if (!Array.isArray(value) || value.length === 0) return void 0;
	return listOf(value, toolPlanItem) ?? void 0;
}
function toolPlanItem(item) {
	if (!isRecord(item)) return null;
	const { text, status } = item;
	return hasText(text) && hasText(status) ? {
		text,
		status
	} : null;
}
function toolTaskMetadata(value) {
	if (!isRecord(value)) return void 0;
	const textOf = (candidate) => hasText(candidate) ? candidate : void 0;
	const task = definedProps({
		id: textOf(value.id),
		subject: textOf(value.subject),
		status: textOf(value.status)
	});
	return Object.keys(task).length > 0 ? task : void 0;
}
function isToolCallDetails(value) {
	return Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.label === "string" && typeof item.value === "string");
}
// src/sse.ts
/**
* Splits an accumulating SSE text buffer into complete frames. Feed it the
* concatenation of everything received so far that wasn't consumed; it returns
* the parsed frames and the trailing incomplete remainder to carry forward.
*/
function parseSseBuffer(buffer) {
	const events = [];
	const holdCr = buffer.endsWith("\r");
	const parts = (holdCr ? buffer.slice(0, -1) : buffer).split(/(?:\r\n|\r(?!\n)|\n){2}/);
	const remainder = (parts.pop() ?? "") + (holdCr ? "\r" : "");
	for (const block of parts) {
		let event = "message";
		const dataLines = [];
		for (const line of block.split(/\r\n|\n|\r/)) if (line.startsWith("event:")) event = line.slice(6).trim();
		else if (line.startsWith("data:")) {
			const value = line.slice(5);
			dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
		}
		if (dataLines.length === 0) continue;
		const text = dataLines.join("\n");
		let data = text;
		try {
			data = JSON.parse(text);
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
/** Converts a typed event into its wire frame: the `type` discriminant becomes
* the SSE event name; the rest becomes the data payload. The `controls` and
* `view` specs are sent directly as the payload (not wrapped in `{spec}`). */
function toSseEvent(ev) {
	if (ev.type === "controls") return {
		event: "controls",
		data: ev.spec
	};
	if (ev.type === "view") return {
		event: "view",
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
		reader.cancel(err).catch(() => {});
		throw err;
	} finally {
		reader.releaseLock();
	}
}
export { BUILD_PROMPT, CHAT_PROMPT, CHAT_TITLE_MAX_LENGTH, CHAT_TITLE_RECENT_MESSAGE_LIMIT, CHAT_TITLE_TASK_MAX_LENGTH, CONTROLS_BLOCK_NAME, HTML_BLOCK_NAME, HTML_SEND_MAX, LEGACY_CONTROLS_BLOCK_NAME, LEGACY_QUESTION_BLOCK_NAME, PLAN_PROMPT, PROTOCOL_VERSION, QUESTION_BLOCK_NAME, QUESTION_PROMPT, VIEW_BLOCK_NAME, VIEW_CATALOG, VIEW_PROMPT, consumeSseResponse, encodeChatEvent, fallbackChatTitle, formatQuestionAnswers, formatSseEvent, initialControlValues, isTerminalEvent, mapSseToChatEvent, normalizeChatTitle, normalizeTaskSummary, parseControlsBlock, parseHtmlBlock, parseHtmlFrameMessage, parseProposedPlan, parseQuestionBlock, parseSseBuffer, parseViewBlock, threadTitleEvent, threadTitleSnapshotEvent, toChatTitleMessages, toSseEvent, truncateChatTitle, validateControls, validateViewSpec, valuesEqual };

//# sourceMappingURL=index.js.map