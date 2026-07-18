import { a as parseControlsBlock, t as parseQuestionBlock } from "../question-COPKqYxO.js";
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
		case "Agent": return "Task";
		default: return "Details";
	}
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
	const onAssistantText = (text) => {
		const parsedQuestion = parseQuestionBlock(text);
		const parsedControls = parseControlsBlock(parsedQuestion.text);
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
	const onToolUse = (info) => {
		const details = toolCallDetails(info);
		emit({
			type: "tool_use",
			name: info.name,
			...info.summary !== void 0 ? { summary: info.summary } : {},
			...details.length > 0 ? { details } : {}
		});
	};
	const onStderr = (chunk) => {
		emit({
			type: "stderr",
			chunk
		});
	};
	return {
		callbacks: {
			onSessionId,
			onAssistantText,
			onToolUse,
			onStderr
		},
		finish(result) {
			emitTerminal({
				type: "done",
				exitCode: result.exitCode
			});
		},
		fail(err) {
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
export { createChatEventBridge, createTaskStore, toolCallDetails };

//# sourceMappingURL=index.js.map