import { i as validateControls, r as parseControlsBlock, t as parseQuestionBlock } from "../question-Da5kVhU_.js";
//#region src/server/tool-details.ts
function text(value) {
	if (typeof value !== "string") return void 0;
	return value.trim() || void 0;
}
function detail(label, value) {
	const normalized = text(value);
	return normalized ? {
		label,
		value: normalized
	} : void 0;
}
function fallbackLabel(name) {
	switch (name) {
		case "Bash": return "Command";
		case "Read":
		case "Edit":
		case "MultiEdit":
		case "Write": return "File";
		case "NotebookEdit": return "Notebook";
		case "Grep":
		case "Glob": return "Pattern";
		case "WebFetch": return "URL";
		case "WebSearch": return "Query";
		case "Task":
		case "Agent":
		case "TaskCreate":
		case "TaskUpdate": return "Task";
		default: return "Details";
	}
}
function displayStatus(value) {
	const status = text(value)?.replace(/_/g, " ");
	return status ? status.charAt(0).toUpperCase() + status.slice(1) : void 0;
}
/** Extracts the stable task identity that clients use to correlate task calls. */
function toolTaskMetadata(info) {
	if (info.name !== "TaskCreate" && info.name !== "TaskUpdate") return void 0;
	const input = info.input;
	if (!input) return void 0;
	const id = text(input.taskId);
	const subject = text(input.subject);
	const status = text(input.status);
	const task = {
		...id ? { id } : {},
		...subject ? { subject } : {},
		...status ? { status } : {}
	};
	return Object.keys(task).length > 0 ? task : void 0;
}
function fileChangeLabel(kind) {
	switch (kind) {
		case "update":
		case "modify":
		case "modified": return "Modified file";
		case "add":
		case "create":
		case "added": return "Added file";
		case "delete":
		case "deleted": return "Deleted file";
		default: return "File";
	}
}
function codexFileChanges(input) {
	if (input.type !== "file_change" || !Array.isArray(input.changes)) return [];
	const details = [];
	for (const change of input.changes) {
		if (!change || typeof change !== "object" || Array.isArray(change)) continue;
		const record = change;
		const file = detail(fileChangeLabel(record.kind), record.path);
		if (file) details.push(file);
	}
	return details;
}
/**
* Reduce provider-specific raw tool input to the useful values the transcript
* should retain.
*/
function toolCallDetails(info) {
	const input = info.input;
	const details = [];
	if (input) {
		if (info.name === "Edit") details.push(...codexFileChanges(input));
		const add = (label, value) => {
			const next = detail(label, value);
			if (next) details.push(next);
		};
		switch (info.name) {
			case "Bash":
				add("Command", input.command);
				break;
			case "Read":
			case "Edit":
			case "MultiEdit":
			case "Write":
				add("File", input.file_path);
				break;
			case "NotebookEdit":
				add("Notebook", input.notebook_path ?? input.file_path);
				break;
			case "Grep":
			case "Glob":
				add("Pattern", input.pattern);
				add("Path", input.path);
				break;
			case "WebFetch":
				add("URL", input.url);
				break;
			case "WebSearch":
				add("Query", input.query);
				break;
			case "Task":
			case "Agent":
				add("Task", input.description);
				break;
			case "TaskCreate":
				add("Task", input.subject);
				add("Task ID", input.taskId);
				add("Description", input.description);
				add("Active form", input.activeForm);
				break;
			case "TaskUpdate":
				add("Task", input.subject);
				add("Task ID", input.taskId);
				add("Status", displayStatus(input.status));
				break;
		}
	}
	if (details.length === 0) {
		const fallback = detail(fallbackLabel(info.name), info.summary);
		if (fallback) details.push(fallback);
	}
	return details;
}
//#endregion
//#region src/server/bridge.ts
function createChatEventBridge(emit, options = {}) {
	let announcedSessionId = options.knownSessionId;
	let terminal = false;
	const pendingTaskCreates = /* @__PURE__ */ new Map();
	const taskSubjects = /* @__PURE__ */ new Map();
	const announceSession = (sessionId) => {
		if (sessionId === announcedSessionId) return;
		announcedSessionId = sessionId;
		emit({
			type: "session_started",
			sessionId,
			protocolVersion: 1
		});
	};
	const emitTerminal = (ev) => {
		if (terminal) return;
		terminal = true;
		emit(ev);
	};
	if (options.presetSessionId) announceSession(options.presetSessionId);
	const onSessionId = (id) => {
		announceSession(id);
	};
	const controlsValidator = options.controlsValidator ?? validateControls;
	const onAssistantText = (text) => {
		const parsedQuestion = parseQuestionBlock(text);
		const parsedControls = parseControlsBlock(parsedQuestion.text, controlsValidator);
		if (!parsedControls.controls && parsedControls.text) emit({
			type: "assistant_text",
			text: parsedControls.text
		});
		if (parsedQuestion.question) emit({
			type: "question",
			...parsedQuestion.question
		});
		if (parsedControls.controls) emit({
			type: "controls",
			spec: parsedControls.controls
		});
	};
	const emitToolUse = (info) => {
		const details = toolCallDetails(info);
		const task = toolTaskMetadata(info);
		if (task?.id && task.subject) taskSubjects.set(task.id, task.subject);
		emit({
			type: "tool_use",
			name: info.name,
			...info.summary !== void 0 ? { summary: info.summary } : {},
			...details.length > 0 ? { details } : {},
			...task ? { task } : {}
		});
	};
	const withKnownTaskSubject = (info) => {
		if (info.name !== "TaskUpdate" || !info.input) return info;
		const taskId = typeof info.input.taskId === "string" ? info.input.taskId.trim() : "";
		const subject = taskSubjects.get(taskId);
		return subject ? {
			...info,
			input: {
				...info.input,
				subject
			}
		} : info;
	};
	const onToolUse = (info) => {
		if (info.name === "TaskCreate" && info.callId) {
			pendingTaskCreates.set(info.callId, info);
			return;
		}
		emitToolUse(withKnownTaskSubject(info));
	};
	const resultText = (content) => {
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return void 0;
		const parts = content.flatMap((block) => {
			if (!block || typeof block !== "object" || Array.isArray(block)) return [];
			const value = block.text;
			return typeof value === "string" ? [value] : [];
		});
		return parts.length > 0 ? parts.join("\n") : void 0;
	};
	const taskIdFromResult = (result) => {
		if (result.isError) return void 0;
		return resultText(result.content)?.match(/Task #([^\s:]+) created successfully/)?.[1];
	};
	const onToolResult = (result) => {
		const pending = pendingTaskCreates.get(result.callId);
		if (!pending) return;
		pendingTaskCreates.delete(result.callId);
		const taskId = taskIdFromResult(result);
		emitToolUse(taskId ? {
			...pending,
			input: {
				...pending.input,
				taskId
			}
		} : pending);
	};
	const flushPendingTaskCreates = () => {
		for (const pending of pendingTaskCreates.values()) emitToolUse(pending);
		pendingTaskCreates.clear();
	};
	const onStderr = (chunk) => {
		emit({
			type: "stderr",
			chunk
		});
	};
	const onUsage = (usage) => {
		emit({
			type: "context_usage",
			contextTokens: usage.contextTokens,
			...usage.contextWindow !== void 0 ? { contextWindow: usage.contextWindow } : {},
			...usage.model !== void 0 ? { model: usage.model } : {}
		});
	};
	return {
		callbacks: {
			onSessionId,
			onAssistantText,
			onToolUse,
			onToolResult,
			onStderr,
			onUsage
		},
		finish(result) {
			flushPendingTaskCreates();
			emitTerminal({
				type: "done",
				exitCode: result.exitCode
			});
		},
		fail(err) {
			flushPendingTaskCreates();
			const name = err?.name;
			if (name === "AbortError") emitTerminal({
				type: "aborted",
				reason: "user"
			});
			else if (name === "TimeoutError") emitTerminal({
				type: "aborted",
				reason: "timeout"
			});
			else emitTerminal({
				type: "error",
				message: err instanceof Error ? err.message : String(err)
			});
		}
	};
}
//#endregion
//#region src/server/task-store.ts
const DEFAULT_COMPLETE_TTL_MS = 5 * 6e4;
function createTaskStore(options = {}) {
	const defaultTtl = options.completeTtlMs ?? DEFAULT_COMPLETE_TTL_MS;
	const tasks = /* @__PURE__ */ new Map();
	return {
		get(id) {
			return tasks.get(id);
		},
		create(id) {
			const existing = tasks.get(id);
			if (existing) return existing;
			const task = {
				id,
				events: [],
				done: false,
				abort: new AbortController(),
				subscribers: /* @__PURE__ */ new Set()
			};
			tasks.set(id, task);
			return task;
		},
		push(task, ev) {
			if (task.done || tasks.get(task.id) !== task) return;
			task.events.push(ev);
			for (const sub of [...task.subscribers]) try {
				sub(ev);
			} catch {}
		},
		subscribe(task, listener) {
			task.subscribers.add(listener);
			return () => {
				task.subscribers.delete(listener);
			};
		},
		complete(task, completeOptions = {}) {
			if (task.done) return;
			task.done = true;
			const ttl = completeOptions.ttlMs ?? defaultTtl;
			task.cleanupTimer = setTimeout(() => {
				tasks.delete(task.id);
			}, ttl);
		},
		cancel(id) {
			const task = tasks.get(id);
			if (!task) return false;
			task.abort.abort();
			return true;
		},
		delete(id) {
			const task = tasks.get(id);
			if (!task) return;
			if (task.cleanupTimer) {
				clearTimeout(task.cleanupTimer);
				delete task.cleanupTimer;
			}
			tasks.delete(id);
		}
	};
}
//#endregion
export { createChatEventBridge, createTaskStore, toolCallDetails, toolTaskMetadata };

//# sourceMappingURL=index.js.map