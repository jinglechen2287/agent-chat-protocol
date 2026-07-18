import { a as parseControlsBlock, i as initialControlValues, n as buildStyleMap, o as validateControls, r as composeApplyMessage, s as valuesEqual, t as parseQuestionBlock } from "./question-B4Nrnylj.js";
//#region src/events.ts
/**
* Version of this event contract. Servers include it on `session_started` so
* clients replaying buffered events across a deploy can detect skew.
*/
const PROTOCOL_VERSION = 1;
/** True for the three events that end a turn's stream: `done`, `aborted`,
* `error`. After one of these, no further events arrive for the turn. */
function isTerminalEvent(ev) {
	return ev.type === "done" || ev.type === "aborted" || ev.type === "error";
}
//#endregion
//#region src/sse.ts
/**
* Splits an accumulating SSE text buffer into complete frames. Feed it the
* concatenation of everything received so far that wasn't consumed; it returns
* the parsed frames and the trailing incomplete remainder to carry forward.
*/
function parseSseBuffer(buffer) {
	const events = [];
	const parts = buffer.split("\n\n");
	const remainder = parts.pop() ?? "";
	for (const block of parts) {
		let event = "message";
		const dataLines = [];
		for (const line of block.split("\n")) if (line.startsWith("event:")) event = line.slice(6).trim();
		else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
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
			return {
				type: "tool_use",
				name,
				...typeof summary === "string" ? { summary } : {},
				...details ? { details } : {}
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
/**
* Reads a fetch Response body as an SSE stream, mapping each frame into a
* typed event. Resolves when the stream ends; rejects on a non-OK response.
* Frames that don't map (unknown names, malformed payloads) are skipped.
*/
async function consumeSseResponse(res, onEvent) {
	if (!res.ok || !res.body) {
		const text = await res.text().catch(() => "");
		throw new Error(`chat stream request failed (${res.status}): ${text}`);
	}
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
			const mapped = mapSseToChatEvent(ev);
			if (mapped) onEvent(mapped);
		}
	}
}
function isToolCallDetails(value) {
	return Array.isArray(value) && value.length > 0 && value.every((item) => item !== null && typeof item === "object" && !Array.isArray(item) && typeof item.label === "string" && typeof item.value === "string");
}
//#endregion
//#region src/prompt.ts
/**
* The emit side of the generative-UI grammar: prompt sections that teach an
* agent when and how to end a message with an ```agent-question``` or
* ```agent-controls``` block. Apps append these to their system prompt (Claude
* `--append-system-prompt`, Codex `developerInstructions`) so the grammar
* survives long conversations where early user messages get compacted away.
*
* Kept in this package alongside the parse-side (parseQuestionBlock /
* parseControlsBlock) so the two can't drift.
*
* Compose what fits the app: a non-DOM client (a phone app, a Telegram bot)
* appends only QUESTION_PROMPT; a DOM client appends GENERATIVE_UI_PROMPT.
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
/** Teaches the controls block, including the scope model. The scope guidance
* assumes the conversation is about a page with selectable elements — apps
* without that context should still include this section unchanged; the agent
* simply won't have elements to scope to and the user won't be offered
* element-picking flows. */
const CONTROLS_PROMPT = [
	"- When the request is about tuning a continuous visual property by eye (shadows, corner radius, colors, spacing, typography scale), do not guess final values and do not edit code that turn. Instead end your message with a controls block; the user gets live number inputs with scrubbers and pickers and will send you the final values to implement:",
	`  \`\`\`${CONTROLS_BLOCK_NAME}`,
	"  {\"title\": \"Card shadow & corners\", \"scope\": {\"type\": \"element\"}, \"controls\": [{\"id\": \"y\", \"type\": \"slider\", \"label\": \"Offset Y\", \"min\": -20, \"max\": 40, \"step\": 1, \"unit\": \"px\", \"value\": 4}, {\"id\": \"blur\", \"type\": \"slider\", \"label\": \"Blur\", \"min\": 0, \"max\": 80, \"step\": 1, \"unit\": \"px\", \"value\": 12}, {\"id\": \"shadowColor\", \"type\": \"color\", \"label\": \"Shadow color\", \"value\": \"#1f293733\"}, {\"id\": \"radius\", \"type\": \"slider\", \"label\": \"Corner radius\", \"min\": 0, \"max\": 32, \"step\": 1, \"unit\": \"px\", \"value\": 8}, {\"id\": \"weight\", \"type\": \"select\", \"label\": \"Font weight\", \"options\": [\"400\", \"500\", \"600\", \"700\"], \"value\": \"600\"}], \"styles\": [{\"property\": \"box-shadow\", \"template\": \"0px {y} {blur} 0px {shadowColor}\"}, {\"property\": \"border-radius\", \"template\": \"{radius}\"}, {\"property\": \"font-weight\", \"template\": \"{weight}\"}]}",
	"  ```",
	"  Scope: you must inspect the request and source structure, then choose the adjustment and preview scope yourself. Use {\"type\": \"element\"} when the user explicitly means only the selected element instance or the element is unique. Use {\"type\": \"selector\", \"selector\": \"img.project-images\", \"label\": \"All project images\"} when the selected instance is governed by a repeated shared class or component and the change naturally belongs in that shared source styling, unless the user explicitly asks for only this instance. A selector scope must be a stable class selector (optionally prefixed by a tag), must include the picked element, and must not use selector lists, combinators, attributes, pseudo-classes, or a tag by itself.",
	"  Rules: when emitting controls, output only the controls block — no prose before or after it. Do not include file excerpts, relevant rules, search results, implementation notes, or explanations that a property does not exist. If the property is absent, use a sensible visual default for the initial value and render the controls anyway. Emit at most one block; include exactly one \"scope\"; use 1–8 controls; every control id must appear in at least one style template; templates compose full CSS values with {id} placeholders (hardcode the parts you don't want tuned); slider values get \"unit\" appended automatically; seed each control's \"value\" from the element's computed styles in the message context when available so the panel starts at the current rendering. The user's follow-up \"Apply these style values...\" message contains the final CSS — implement it in the project's existing styling idiom.",
	"  Lifecycle: a controls panel stays live only until the next user message. Sending any next user message — including a typed follow-up or the dedicated Apply follow-up — immediately disables that panel and clears its temporary preview, restoring the source-rendered styles. Never tell the user that an earlier controls panel is still live or usable after a follow-up. If controls are needed again, emit a new controls block.",
	"- For one-shot changes (\"make it red\"), just edit — don't emit controls."
].join("\n");
/** Both grammar sections, ready to append to an app's system prompt. */
const GENERATIVE_UI_PROMPT = [QUESTION_PROMPT, CONTROLS_PROMPT].join("\n");
//#endregion
export { CONTROLS_BLOCK_NAME, CONTROLS_PROMPT, GENERATIVE_UI_PROMPT, LEGACY_CONTROLS_BLOCK_NAME, LEGACY_QUESTION_BLOCK_NAME, PROTOCOL_VERSION, QUESTION_BLOCK_NAME, QUESTION_PROMPT, buildStyleMap, composeApplyMessage, consumeSseResponse, encodeChatEvent, formatSseEvent, initialControlValues, isTerminalEvent, mapSseToChatEvent, parseControlsBlock, parseQuestionBlock, parseSseBuffer, toSseEvent, validateControls, valuesEqual };

//# sourceMappingURL=index.js.map