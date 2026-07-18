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
//#region src/controls.ts
/** Defensive ceilings — the agent is asked for less; a runaway block should
* degrade to plain text rather than flood the client. */
const MAX_CONTROLS = 12;
const MAX_STYLES = 8;
const MAX_SELECT_OPTIONS = 12;
const MAX_LABEL_LENGTH = 40;
const MAX_TITLE_LENGTH = 60;
const MAX_TEMPLATE_LENGTH = 200;
const MAX_SCOPE_SELECTOR_LENGTH = 160;
const MAX_SCOPE_LABEL_LENGTH = 60;
const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const PROPERTY_RE = /^-?[a-z][a-z-]*$/;
/** Stable shared scopes are intentionally limited to an optional tag plus
* one or more classes. This excludes broad tag-only, positional, relational,
* and selector-list targeting while covering semantic and CSS-module classes. */
const SCOPE_SELECTOR_RE = /^(?:[a-z][a-z0-9-]*)?(?:\.[A-Za-z_-][A-Za-z0-9_-]*)+$/;
const PLACEHOLDER_RE = /\{([^{}]*)\}/g;
/** Screens templates and substituted values. Beyond URL-bearing syntax, a
* value must stay a single CSS declaration: `;` and newlines would smuggle
* extra declarations into cssText or the Apply message. (Braces can't be
* screened here — templates legitimately contain `{id}` placeholders.) */
const UNSAFE_CSS_VALUE_RE = /(?:url\s*\(|expression\s*\(|@import|\/\*|\\|;|[\r\n])/i;
/** Extra screen for fully substituted values, where braces have no legitimate
* use and would allow escaping a rule body in a stylesheet context. */
const UNSAFE_SUBSTITUTED_VALUE_RE = /[{}]/;
/** Properties intentionally supported by the inline preview. Keeping this
* list visual and URL-free prevents an assistant-authored controls block from
* turning the user's browser into a network-request primitive. `filter` and
* `backdrop-filter` are useful for visual tuning, so their values are also
* screened for URL-bearing syntax below. */
const ALLOWED_STYLE_PROPERTIES = /* @__PURE__ */ new Set([
	"color",
	"background-color",
	"opacity",
	"font-family",
	"font-size",
	"font-style",
	"font-weight",
	"line-height",
	"letter-spacing",
	"text-align",
	"text-transform",
	"text-shadow",
	"border",
	"border-radius",
	"border-top-left-radius",
	"border-top-right-radius",
	"border-bottom-right-radius",
	"border-bottom-left-radius",
	"border-width",
	"border-top-width",
	"border-right-width",
	"border-bottom-width",
	"border-left-width",
	"border-style",
	"border-color",
	"box-shadow",
	"outline",
	"outline-color",
	"outline-offset",
	"outline-style",
	"outline-width",
	"padding",
	"padding-top",
	"padding-right",
	"padding-bottom",
	"padding-left",
	"margin",
	"margin-top",
	"margin-right",
	"margin-bottom",
	"margin-left",
	"gap",
	"row-gap",
	"column-gap",
	"width",
	"height",
	"min-width",
	"min-height",
	"max-width",
	"max-height",
	"display",
	"flex-basis",
	"flex-grow",
	"flex-shrink",
	"align-items",
	"align-self",
	"justify-content",
	"transform",
	"transform-origin",
	"filter",
	"backdrop-filter",
	"-webkit-backdrop-filter",
	"transition-duration",
	"transition-timing-function"
]);
/** Validates an unknown JSON value into a ControlsSpec. Any violation returns
* null — malformed blocks are left in the message as plain text. */
function validateControls(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const obj = value;
	let title;
	if (obj.title !== void 0) {
		if (typeof obj.title !== "string" || obj.title.length > MAX_TITLE_LENGTH) return null;
		const trimmed = obj.title.trim();
		if (trimmed) title = trimmed;
	}
	let scope;
	if (obj.scope !== void 0) {
		scope = validateControlsScope(obj.scope) ?? void 0;
		if (!scope) return null;
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
	if (!Array.isArray(obj.styles)) return null;
	if (obj.styles.length < 1 || obj.styles.length > MAX_STYLES) return null;
	const styles = [];
	const referenced = /* @__PURE__ */ new Set();
	for (const entry of obj.styles) {
		const binding = validateBinding(entry, ids, referenced);
		if (!binding) return null;
		styles.push(binding);
	}
	for (const id of ids) if (!referenced.has(id)) return null;
	return {
		...title === void 0 ? {} : { title },
		...scope === void 0 ? {} : { scope },
		controls,
		styles
	};
}
function validateControlsScope(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const obj = value;
	if (obj.type === "element") return { type: "element" };
	if (obj.type !== "selector" || typeof obj.selector !== "string") return null;
	const selector = obj.selector.trim();
	if (!selector || selector.length > MAX_SCOPE_SELECTOR_LENGTH || !SCOPE_SELECTOR_RE.test(selector)) return null;
	let label;
	if (obj.label !== void 0) {
		if (typeof obj.label !== "string") return null;
		const trimmed = obj.label.trim();
		if (!trimmed || trimmed.length > MAX_SCOPE_LABEL_LENGTH) return null;
		label = trimmed;
	}
	return label === void 0 ? {
		type: "selector",
		selector
	} : {
		type: "selector",
		selector,
		label
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
function validateBinding(value, ids, referenced) {
	if (!value || typeof value !== "object") return null;
	const obj = value;
	if (typeof obj.property !== "string" || !PROPERTY_RE.test(obj.property)) return null;
	if (!ALLOWED_STYLE_PROPERTIES.has(obj.property)) return null;
	if (typeof obj.template !== "string") return null;
	const template = obj.template.trim();
	if (!template || template.length > MAX_TEMPLATE_LENGTH) return null;
	if (UNSAFE_CSS_VALUE_RE.test(template)) return null;
	for (const match of template.matchAll(PLACEHOLDER_RE)) {
		const id = match[1] ?? "";
		if (!ids.has(id)) return null;
		referenced.add(id);
	}
	return {
		property: obj.property,
		template
	};
}
/** Initial values keyed by control id — the panel's starting state, seeded by
* the agent from the element's computed styles. */
function initialControlValues(spec) {
	const values = {};
	for (const control of spec.controls) values[control.id] = control.value;
	return values;
}
/** Substitutes `{id}` placeholders in every binding template, producing a
* CSS property → value map ready for inline-style preview or Apply. */
function buildStyleMap(spec, values) {
	const byId = new Map(spec.controls.map((c) => [c.id, c]));
	const styleMap = {};
	for (const binding of spec.styles) {
		const value = binding.template.replace(PLACEHOLDER_RE, (whole, id) => {
			const control = byId.get(id);
			if (!control) return whole;
			return formatControlValue(control, Object.prototype.hasOwnProperty.call(values, id) ? values[id] : void 0);
		});
		if (!UNSAFE_CSS_VALUE_RE.test(value) && !UNSAFE_SUBSTITUTED_VALUE_RE.test(value)) styleMap[binding.property] = value;
	}
	return styleMap;
}
function formatControlValue(control, raw) {
	if (control.type === "slider") {
		const num = typeof raw === "number" ? raw : Number(raw);
		const finite = Number.isFinite(num) ? num : control.value;
		return `${Math.min(control.max, Math.max(control.min, finite))}${control.unit ?? ""}`;
	}
	const value = raw === void 0 ? control.value : String(raw);
	return String(value);
}
/** The visible user message the Apply button sends into the chat. This is the
* controls round-trip: the client composes it from the final style map and the
* spec's scope and sends it as the next user turn. */
function composeApplyMessage(styles, scope = { type: "element" }) {
	const declarations = Object.entries(styles).map(([property, value]) => `${property}: ${value}`).join("\n");
	if (scope.type === "selector") return `Apply these style values from the tuning panel to every element matching the selector \`${scope.selector}\`:\n
${declarations}\n
Implement them in this project's shared styling rule or component using its existing styling approach (Tailwind classes, CSS files, styled-components, etc.) — not inline styles. Keep the change minimal.`;
	return `Apply these style values from the tuning panel to the element the controls were created for:

${declarations}\n
Implement them in this project's existing styling approach (Tailwind classes, CSS files, styled-components, etc.) — not inline styles. Keep the change minimal.`;
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
function parseControlsBlock(raw) {
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
	const controls = validateControls(parsed);
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
export { parseControlsBlock as a, PROTOCOL_VERSION as c, initialControlValues as i, isTerminalEvent as l, buildStyleMap as n, validateControls as o, composeApplyMessage as r, valuesEqual as s, parseQuestionBlock as t };

//# sourceMappingURL=question-BPFDhLUt.js.map