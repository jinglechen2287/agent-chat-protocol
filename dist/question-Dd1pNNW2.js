//#region src/events.ts
/**
* Version of this event contract. Servers include it on `session_started` so
* clients replaying buffered events across a deploy can detect skew.
*/
const PROTOCOL_VERSION = 2;
/** True for the three events that end a turn's stream: `done`, `aborted`,
* `error`. After one of these, no further events arrive for the turn. */
function isTerminalEvent(ev) {
	return ev.type === "done" || ev.type === "aborted" || ev.type === "error";
}
//#endregion
//#region src/controls.ts
/** Defensive ceilings — the agent is asked for less; a runaway block should
* degrade to plain text rather than flood the client. */
const MAX_CONTROLS = 12;
const MAX_SELECT_OPTIONS = 12;
const MAX_LABEL_LENGTH = 40;
const MAX_TITLE_LENGTH = 60;
const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
/**
* Validates an unknown JSON value into the core ControlsSpec. Any violation
* returns null — malformed blocks are left in the message as plain text.
* Unknown fields (app extensions) are ignored, not rejected: extension
* validation belongs to the app validator layered on top.
*/
function validateControls(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const obj = value;
	let title;
	if (obj.title !== void 0) {
		if (typeof obj.title !== "string" || obj.title.length > MAX_TITLE_LENGTH) return null;
		const trimmed = obj.title.trim();
		if (trimmed) title = trimmed;
	}
	if (!Array.isArray(obj.controls)) return null;
	if (obj.controls.length < 1 || obj.controls.length > MAX_CONTROLS) return null;
	const controls = [];
	const ids = /* @__PURE__ */ new Set();
	for (const entry of obj.controls) {
		const control = validateControl(entry);
		if (!control || ids.has(control.id)) return null;
		ids.add(control.id);
		controls.push(control);
	}
	return {
		...title === void 0 ? {} : { title },
		controls
	};
}
function validateControl(value) {
	if (!value || typeof value !== "object") return null;
	const obj = value;
	if (typeof obj.id !== "string" || !ID_RE.test(obj.id)) return null;
	if (typeof obj.label !== "string") return null;
	const label = obj.label.trim();
	if (!label || label.length > MAX_LABEL_LENGTH) return null;
	switch (obj.type) {
		case "slider": {
			const { min, max, step, value: initial } = obj;
			if (typeof min !== "number" || !Number.isFinite(min)) return null;
			if (typeof max !== "number" || !Number.isFinite(max)) return null;
			if (min >= max) return null;
			let stepOut;
			if (step !== void 0) {
				if (typeof step !== "number" || !Number.isFinite(step) || step <= 0) return null;
				stepOut = step;
			}
			let unit;
			if (obj.unit !== void 0) {
				if (typeof obj.unit !== "string") return null;
				const trimmed = obj.unit.trim();
				if (trimmed) unit = trimmed;
			}
			if (typeof initial !== "number" || !Number.isFinite(initial)) return null;
			const clamped = Math.min(max, Math.max(min, initial));
			return {
				id: obj.id,
				type: "slider",
				label,
				min,
				max,
				...stepOut !== void 0 ? { step: stepOut } : {},
				...unit !== void 0 ? { unit } : {},
				value: clamped
			};
		}
		case "color": {
			if (typeof obj.value !== "string") return null;
			const color = obj.value.trim();
			if (!color) return null;
			return {
				id: obj.id,
				type: "color",
				label,
				value: color
			};
		}
		case "select": {
			if (!Array.isArray(obj.options)) return null;
			const options = [];
			for (const opt of obj.options) {
				if (typeof opt !== "string") return null;
				const trimmed = opt.trim();
				if (!trimmed) return null;
				options.push(trimmed);
			}
			if (options.length < 2 || options.length > MAX_SELECT_OPTIONS) return null;
			if (typeof obj.value !== "string" || !options.includes(obj.value.trim())) return null;
			return {
				id: obj.id,
				type: "select",
				label,
				options,
				value: obj.value.trim()
			};
		}
		default: return null;
	}
}
/** Initial values keyed by control id — the panel's starting state. */
function initialControlValues(spec) {
	const values = {};
	for (const control of spec.controls) values[control.id] = control.value;
	return values;
}
/** Loose equality over value maps: `4` and `"4"` compare equal because range
* inputs report strings while specs carry numbers. */
function valuesEqual(a, b) {
	if (a === void 0 || b === void 0) return a === b;
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;
	for (const key of aKeys) {
		if (!(key in b)) return false;
		if (String(a[key]) !== String(b[key])) return false;
	}
	return true;
}
/** Matches the first controls fenced block. The info string must be exactly
* the block name (optionally followed by trailing spaces) so plain ```json
* blocks the agent emits for other reasons are ignored. */
const BLOCK_RE$1 = /```(?:agent-controls|carve-controls)[^\S\r\n]*\r?\n([\s\S]*?)\r?\n?```/;
function parseControlsBlock(raw, validate = validateControls) {
	const match = BLOCK_RE$1.exec(raw);
	if (!match) return {
		text: raw,
		controls: null
	};
	let parsed;
	try {
		parsed = JSON.parse((match[1] ?? "").trim());
	} catch {
		return {
			text: raw,
			controls: null
		};
	}
	const controls = validate(parsed);
	if (!controls) return {
		text: raw,
		controls: null
	};
	return {
		text: (raw.slice(0, match.index) + raw.slice(match.index + match[0].length)).replace(/\n{3,}/g, "\n\n").trim(),
		controls
	};
}
//#endregion
//#region src/question.ts
/** Upper bound on rendered option chips — the agent is asked for 2–6; this is
* a defensive ceiling so a runaway block can't flood the client. */
const MAX_OPTIONS = 8;
/** Defensive length ceilings, mirroring the controls schema's. Over-length
* questions invalidate the block; over-length options are skipped. */
const MAX_QUESTION_LENGTH = 500;
const MAX_OPTION_LENGTH = 100;
/** Matches the first question fenced block. The info string must be exactly
* the block name (optionally followed by trailing spaces) so plain ```json
* blocks the agent emits for other reasons are ignored. */
const BLOCK_RE = /```(?:agent-question|carve-question)[^\S\r\n]*\r?\n([\s\S]*?)\r?\n?```/;
function parseQuestionBlock(raw) {
	const match = BLOCK_RE.exec(raw);
	if (!match) return {
		text: raw,
		question: null
	};
	const question = parseBlockBody(match[1] ?? "");
	if (!question) return {
		text: raw,
		question: null
	};
	return {
		text: (raw.slice(0, match.index) + raw.slice(match.index + match[0].length)).replace(/\n{3,}/g, "\n\n").trim(),
		question
	};
}
function parseBlockBody(body) {
	let parsed;
	try {
		parsed = JSON.parse(body.trim());
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const obj = parsed;
	if (typeof obj.question !== "string") return null;
	const question = obj.question.trim();
	if (!question || question.length > MAX_QUESTION_LENGTH) return null;
	if (!Array.isArray(obj.options)) return null;
	const options = [];
	const seen = /* @__PURE__ */ new Set();
	for (const opt of obj.options) {
		if (typeof opt !== "string") continue;
		const trimmed = opt.trim();
		if (trimmed && trimmed.length <= MAX_OPTION_LENGTH && !seen.has(trimmed)) {
			seen.add(trimmed);
			options.push(trimmed);
		}
		if (options.length >= MAX_OPTIONS) break;
	}
	if (options.length < 2) return null;
	return {
		question,
		options
	};
}
//#endregion
export { valuesEqual as a, validateControls as i, initialControlValues as n, PROTOCOL_VERSION as o, parseControlsBlock as r, isTerminalEvent as s, parseQuestionBlock as t };

//# sourceMappingURL=question-Dd1pNNW2.js.map