import * as z from "zod";
//#region src/events.ts
/**
* Version of this event contract. Servers include it on `session_started` so
* clients replaying buffered events across a deploy can detect skew.
*/
const PROTOCOL_VERSION = 6;
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
const ID_RE$1 = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
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
	if (typeof obj.id !== "string" || !ID_RE$1.test(obj.id)) return null;
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
const BLOCK_RE$3 = /```(?:agent-controls|carve-controls)[^\S\r\n]*\r?\n([\s\S]*?)\r?\n?```/;
function parseControlsBlock(raw, validate = validateControls) {
	const match = BLOCK_RE$3.exec(raw);
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
const VIEW_BLOCK_NAME = "agent-view";
const HTML_BLOCK_NAME = "agent-html";
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
//#region src/view.ts
/**
* The ```agent-view``` grammar: a generative-UI view composed from a fixed
* component catalog, one JSON object per line.
*
* The catalog is the whole security and coherence story. The agent can only
* name components defined here; it picks semantics (variants, levels,
* statuses) and never pixels (no color/spacing/font props anywhere). Each
* entry pairs its zod schema with the prompt line that teaches it, so the
* validator and the prompt live one line apart and a test keeps VIEW_PROMPT
* covering every entry.
*
* Degradation rules mirror controls.ts: an invalid line is skipped and the
* rest of the view renders; a view with no valid root degrades to plain
* text. Component references form a tree — each id renders at most once, and
* repeat, cyclic, dangling, or too-deep references are pruned rather than
* failing the view.
*/
const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
/** Client-local state variables: `$region`, `$granularity`. */
const BIND_RE = /^\$[a-zA-Z][a-zA-Z0-9_]*$/;
const id = z.string().regex(ID_RE).max(40);
const ref = z.string().regex(ID_RE).max(40);
const children = z.array(ref).max(40);
const label = z.string().min(1).max(80);
const shortText = z.string().max(500);
const longText = z.string().max(2e4);
const cell = z.union([
	z.string().max(500),
	z.number(),
	z.boolean(),
	z.null()
]);
function component(type, shape) {
	return z.object({
		id,
		type: z.literal(type),
		...shape
	});
}
const button = component("Button", {
	label,
	variant: z.enum([
		"primary",
		"secondary",
		"ghost"
	]).optional(),
	/** Template sent as the next user turn; `{$var}` interpolates input state. */
	message: z.string().min(1).max(1e3).optional(),
	/** External link opened in a new tab. Web-only schemes: z.url() alone
	* admits javascript:/data:, and a click on those would execute
	* agent-authored code in the app origin. */
	href: z.string().url().max(2e3).regex(/^https?:\/\//i).optional()
}).refine((b) => b.message === void 0 !== (b.href === void 0), { message: "Button requires exactly one of message or href" });
/**
* Every component the agent may emit. `prompt` is the exact line VIEW_PROMPT
* teaches for the entry — keep it terse: shape, then when to use it.
*/
const VIEW_CATALOG = {
	Section: {
		schema: component("Section", {
			title: label.optional(),
			subtitle: shortText.optional(),
			children
		}),
		prompt: "Section {title?, subtitle?, children[]} — top-level report region with a heading"
	},
	Grid: {
		schema: component("Grid", {
			columns: z.number().int().min(2).max(4).optional(),
			children
		}),
		prompt: "Grid {columns? 2-4, children[]} — side-by-side cards/stats; collapses on phones"
	},
	Stack: {
		schema: component("Stack", {
			direction: z.enum(["row", "column"]).optional(),
			gap: z.enum([
				"s",
				"m",
				"l"
			]).optional(),
			children
		}),
		prompt: "Stack {direction?, gap?, children[]} — plain vertical (default) or horizontal group"
	},
	Card: {
		schema: component("Card", {
			title: label.optional(),
			children
		}),
		prompt: "Card {title?, children[]} — bordered grouping inside a Grid or Section"
	},
	Divider: {
		schema: component("Divider", {}),
		prompt: "Divider {} — horizontal rule"
	},
	Heading: {
		schema: component("Heading", {
			level: z.number().int().min(1).max(4),
			text: label
		}),
		prompt: "Heading {level 1-4, text}"
	},
	Text: {
		schema: component("Text", {
			value: longText,
			variant: z.enum([
				"body",
				"caption",
				"muted"
			]).optional()
		}),
		prompt: "Text {value, variant?: body|caption|muted} — one plain paragraph"
	},
	Markdown: {
		schema: component("Markdown", { value: longText }),
		prompt: "Markdown {value} — rich prose: links, lists, inline code"
	},
	Badge: {
		schema: component("Badge", {
			label,
			variant: z.enum([
				"neutral",
				"info",
				"success",
				"warn",
				"error"
			]).optional()
		}),
		prompt: "Badge {label, variant?: neutral|info|success|warn|error} — small status chip"
	},
	Callout: {
		schema: component("Callout", {
			variant: z.enum([
				"info",
				"success",
				"warn",
				"error"
			]),
			title: label.optional(),
			children
		}),
		prompt: "Callout {variant: info|success|warn|error, title?, children[]} — highlighted finding"
	},
	Stat: {
		schema: component("Stat", {
			label,
			value: z.string().min(1).max(40),
			delta: z.string().max(40).optional(),
			trend: z.enum([
				"up",
				"down",
				"flat"
			]).optional(),
			spark: z.array(z.number()).max(60).optional()
		}),
		prompt: "Stat {label, value, delta?, trend?: up|down|flat, spark?: number[]} — KPI tile"
	},
	Table: {
		schema: component("Table", {
			columns: z.array(z.object({
				key: z.string().min(1).max(40),
				label,
				align: z.enum([
					"left",
					"center",
					"right"
				]).optional(),
				format: z.enum([
					"number",
					"percent",
					"date"
				]).optional()
			})).min(1).max(12),
			rows: z.array(z.record(z.string(), cell)).max(200),
			sortable: z.boolean().optional()
		}),
		prompt: "Table {columns: {key,label,align?,format?: number|percent|date}[], rows, sortable?} — aggregate first, ≤200 rows"
	},
	Chart: {
		schema: component("Chart", {
			kind: z.enum([
				"line",
				"bar",
				"area",
				"pie",
				"scatter",
				"heatmap"
			]),
			series: z.array(z.object({
				label,
				points: z.array(z.object({
					x: z.union([z.string().max(40), z.number()]),
					y: z.number()
				})).max(300)
			})).min(1).max(8),
			xLabel: label.optional(),
			yLabel: label.optional()
		}),
		prompt: "Chart {kind: line|bar|area|pie|scatter|heatmap, series: {label, points:{x,y}[]}[], xLabel?, yLabel?} — downsample to ≤300 points"
	},
	Progress: {
		schema: component("Progress", {
			label: label.optional(),
			value: z.number(),
			max: z.number().positive().optional()
		}),
		prompt: "Progress {label?, value, max?} — completion bar"
	},
	Code: {
		schema: component("Code", {
			value: longText,
			language: z.string().max(24).optional(),
			filename: z.string().max(200).optional(),
			highlight: z.array(z.tuple([z.number().int().positive(), z.number().int().positive()])).max(20).optional()
		}),
		prompt: "Code {value, language?, filename?, highlight?: [from,to][]} — syntax-highlighted source"
	},
	Diff: {
		schema: component("Diff", {
			value: longText,
			filename: z.string().max(200).optional()
		}),
		prompt: "Diff {value (unified diff), filename?} — colored add/remove rendering"
	},
	Diagram: {
		schema: component("Diagram", { source: z.string().min(1).max(1e4) }),
		prompt: "Diagram {source} — Mermaid: flowcharts, sequence, architecture sketches"
	},
	Timeline: {
		schema: component("Timeline", { items: z.array(z.object({
			label,
			detail: shortText.optional(),
			status: z.enum([
				"done",
				"active",
				"pending",
				"failed"
			])
		})).min(1).max(50) }),
		prompt: "Timeline {items: {label, detail?, status: done|active|pending|failed}[]} — ordered narrative"
	},
	Tabs: {
		schema: component("Tabs", { items: z.array(z.object({
			label,
			children
		})).min(2).max(8) }),
		prompt: "Tabs {items: {label, children[]}[]} — switch between sub-sections locally"
	},
	Details: {
		schema: component("Details", {
			summary: label,
			children,
			open: z.boolean().optional()
		}),
		prompt: "Details {summary, children[], open?} — collapsible section for secondary depth"
	},
	Image: {
		schema: component("Image", {
			src: z.string().url().max(2e3),
			alt: shortText,
			caption: shortText.optional()
		}),
		prompt: "Image {src, alt, caption?}"
	},
	Input: {
		schema: component("Input", {
			bind: z.string().regex(BIND_RE),
			label,
			placeholder: shortText.optional(),
			value: shortText.optional()
		}),
		prompt: "Input {bind: $var, label, placeholder?, value?} — free text"
	},
	Select: {
		schema: component("Select", {
			bind: z.string().regex(BIND_RE),
			label,
			options: z.array(z.string().min(1).max(80)).min(2).max(24),
			value: z.string().max(80)
		}),
		prompt: "Select {bind: $var, label, options[], value}"
	},
	Slider: {
		schema: component("Slider", {
			bind: z.string().regex(BIND_RE),
			label,
			min: z.number(),
			max: z.number(),
			step: z.number().positive().optional(),
			value: z.number()
		}),
		prompt: "Slider {bind: $var, label, min, max, step?, value}"
	},
	Checkbox: {
		schema: component("Checkbox", {
			bind: z.string().regex(BIND_RE),
			label,
			checked: z.boolean().optional()
		}),
		prompt: "Checkbox {bind: $var, label, checked?}"
	},
	DateRange: {
		schema: component("DateRange", {
			bind: z.string().regex(BIND_RE),
			label,
			start: z.string().max(20).optional(),
			end: z.string().max(20).optional()
		}),
		prompt: "DateRange {bind: $var, label, start?, end?} — ISO dates"
	},
	Button: {
		schema: button,
		prompt: "Button {label, variant?: primary|secondary|ghost, message? | href?} — message templates send \"{$var}\"-interpolated text as the next user turn; href opens a link. Exactly one of the two."
	}
};
/** Defensive ceilings — beyond them a block degrades to plain text. */
const MAX_COMPONENTS = 100;
const MAX_DEPTH = 10;
const MAX_BLOCK_BYTES = 65536;
/** Input-side work bound: entries past this are never schema-validated, so a
* hostile frame cannot buy unbounded parse work. Generous headroom over the
* render cap keeps legitimate skipped-line noise from starving late ids. */
const MAX_VALIDATED_ENTRIES = MAX_COMPONENTS * 4;
/** Validates one component line against the catalog — the per-line half of
* {@link validateViewSpec}, exported for streamed `view_line` delivery where
* whole-graph validation cannot run yet. */
function validateViewComponent(value) {
	return validateComponent(value);
}
function validateComponent(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const type = value.type;
	if (typeof type !== "string") return null;
	const entry = VIEW_CATALOG[type];
	if (!entry) return null;
	const parsed = entry.schema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
/** The ids a component renders as children, in slot order. */
function childRefs(c) {
	if ("children" in c) return c.children;
	if (c.type === "Tabs") return c.items.flatMap((item) => item.children);
	return [];
}
/** Returns a copy of the component keeping only child refs in `keep`, in the
* order `keep` lists them (which is first-occurrence order per slot). */
function withPrunedRefs(c, keep) {
	if ("children" in c) {
		const seen = /* @__PURE__ */ new Set();
		const pruned = c.children.filter((child) => {
			if (seen.has(child) || !keep(child)) return false;
			seen.add(child);
			return true;
		});
		return {
			...c,
			children: pruned
		};
	}
	if (c.type === "Tabs") {
		const seen = /* @__PURE__ */ new Set();
		return {
			...c,
			items: c.items.map((item) => ({
				...item,
				children: item.children.filter((child) => {
					if (seen.has(child) || !keep(child)) return false;
					seen.add(child);
					return true;
				})
			}))
		};
	}
	return c;
}
/**
* Validates an unknown `{ components }` value into a ViewSpec. Invalid
* components are skipped, duplicate ids keep the first occurrence, and the
* reference graph is reduced to a tree: reachable from `root`, each id
* rendered at most once, repeat/cyclic/dangling/too-deep references pruned.
* Returns null when no valid `root` component exists.
*/
function validateViewSpec(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const raw = value.components;
	if (!Array.isArray(raw)) return null;
	const byId = /* @__PURE__ */ new Map();
	for (const entry of raw.slice(0, MAX_VALIDATED_ENTRIES)) {
		const parsed = validateComponent(entry);
		if (parsed && !byId.has(parsed.id)) byId.set(parsed.id, parsed);
	}
	const root = byId.get("root");
	if (!root) return null;
	const placed = /* @__PURE__ */ new Set(["root"]);
	const ordered = [];
	const visit = (component, depth) => {
		const keep = (child) => {
			if (depth >= MAX_DEPTH || placed.size >= MAX_COMPONENTS) return false;
			if (placed.has(child) || !byId.has(child)) return false;
			placed.add(child);
			return true;
		};
		const pruned = withPrunedRefs(component, keep);
		ordered.push(pruned);
		for (const child of childRefs(pruned)) visit(byId.get(child), depth + 1);
	};
	visit(root, 1);
	return { components: ordered };
}
/** Matches the first agent-view fenced block; the info string must be exactly
* the block name so ordinary ```json blocks are ignored. */
const BLOCK_RE$2 = /* @__PURE__ */ new RegExp("```agent-view[^\\S\\r\\n]*\\r?\\n([\\s\\S]*?)\\r?\\n?```");
/**
* Extracts the first ```agent-view``` block: one JSON component per line.
* Malformed or unknown lines are skipped; a block with no valid root (or one
* over the size ceiling) is left in the prose as plain text, exactly like a
* malformed controls block.
*/
function parseViewBlock(raw) {
	const match = BLOCK_RE$2.exec(raw);
	if (!match) return {
		text: raw,
		view: null
	};
	const body = match[1] ?? "";
	let view = null;
	if (new TextEncoder().encode(body).length <= MAX_BLOCK_BYTES) {
		const components = [];
		for (const line of body.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				components.push(JSON.parse(trimmed));
			} catch {}
		}
		view = validateViewSpec({ components });
	}
	if (!view) return {
		text: raw,
		view: null
	};
	return {
		text: (raw.slice(0, match.index) + raw.slice(match.index + match[0].length)).replace(/\n{3,}/g, "\n\n").trim(),
		view
	};
}
/** The prompt section that teaches the view grammar. Injected alongside
* QUESTION_PROMPT via --append-system-prompt / developerInstructions; a test
* asserts every catalog entry appears here, so prompt and validator move
* together. */
const VIEW_PROMPT = [
	"- This conversation is in visualization mode: the user has explicitly asked for visual replies. Default to answering with a view, not only for formal reports — reach for one whenever the reply contains numbers, comparisons, trends, rankings, prices, options, steps, or entities with attributes. If you are about to write a paragraph carrying three or more figures, put them in components instead; even a single key number deserves a Stat or Callout. Plain prose alone is right only when there is genuinely nothing to structure (a yes/no, a pure opinion).",
	"- Lead with a sentence or two of prose when context helps, then end the message with the view block (at most one per message):",
	"  ```agent-view",
	"  {\"id\":\"root\",\"type\":\"Section\",\"title\":\"Weekly usage\",\"children\":[\"kpis\",\"detail\"]}",
	"  {\"id\":\"kpis\",\"type\":\"Grid\",\"children\":[\"s1\",\"s2\"]}",
	"  {\"id\":\"s1\",\"type\":\"Stat\",\"label\":\"Turns\",\"value\":\"482\",\"trend\":\"up\"}",
	"  {\"id\":\"s2\",\"type\":\"Stat\",\"label\":\"Errors\",\"value\":\"3\",\"trend\":\"down\"}",
	"  {\"id\":\"detail\",\"type\":\"Text\",\"value\":\"Traffic grew 12% week over week.\"}",
	"  ```",
	"- Rules: one JSON object per line, no wrapping array. The entry component MUST have id \"root\". Containers reference children by id; define every referenced id. Keep views under ~40 components. Aggregate data first — tables ≤200 rows, chart series ≤300 points.",
	"- Pick components for meaning, never styling — there are no color or layout-tuning props. Inputs write client-side $vars; a Button's message template (\"Rerun for {$region}\") sends the interpolated text as the user's next message. Use href Buttons for external links.",
	"- Never invent data to fill a view: visualize the real numbers you have, fetching or computing them first when tools allow. When the data genuinely isn't available, say so in prose or a Callout rather than charting placeholders.",
	"- Catalog:",
	...Object.entries(VIEW_CATALOG).map(([name, entry]) => `  - ${name}: ${entry.prompt.replace(`${name} `, "")}`)
].join("\n");
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
const BLOCK_RE$1 = /```(?:agent-question|carve-question)[^\S\r\n]*\r?\n([\s\S]*?)\r?\n?```/;
function parseQuestionBlock(raw) {
	const match = BLOCK_RE$1.exec(raw);
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
//#region src/html.ts
/**
* The ```agent-html``` grammar: a freeform generated page, streamed raw and
* rendered in a sandboxed frame — the escape hatch for layouts and
* interactions the component catalog can't express.
*
* Unlike a view, the block body is not validated structure: it is an HTML
* document the client morphs into the frame as it streams and re-mounts
* whole once complete. The only vocabulary the protocol fixes is the
* postMessage bridge between the frame and its host, defined here so both
* sides (and the prompt that teaches the in-page `AgentBridge` API) cannot
* drift.
*
* Degradation matches views: an empty or oversized block stays in the prose
* as plain text.
*/
/** Byte ceiling for a block; larger ones degrade to prose. */
const MAX_HTML_BYTES = 262144;
/** Longest text a frame's `AgentBridge.send` may submit as the next user
* message — mirrors the view catalog's Button message cap. */
const HTML_SEND_MAX = 1e3;
/**
* Validates a frame-origin postMessage payload. The frame runs agent-authored
* code, so the host treats its messages as untrusted input: unknown types,
* non-finite heights, and over-long send texts are rejected.
*/
function parseHtmlFrameMessage(data) {
	if (!data || typeof data !== "object" || Array.isArray(data)) return null;
	const { type } = data;
	if (type === "agent-html:ready") return { type };
	if (type === "agent-html:height") {
		const { height } = data;
		if (typeof height !== "number" || !Number.isFinite(height) || height < 0) return null;
		return {
			type,
			height
		};
	}
	if (type === "agent-html:send") {
		const { text } = data;
		if (typeof text !== "string" || text.length === 0 || text.length > 1e3) return null;
		return {
			type,
			text
		};
	}
	return null;
}
/** Matches the first agent-html fenced block. The closing fence must sit
* alone on its own line (optional surrounding whitespace) so backticks
* inside the document — a JS template literal or a ```js example line —
* cannot end the block early. */
const BLOCK_RE = /* @__PURE__ */ new RegExp("```agent-html[^\\S\\r\\n]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*```[ \\t]*(?=\\r?\\n|$)");
/**
* Extracts the first ```agent-html``` block. An empty or oversized block is
* left in the prose as plain text, exactly like a rootless view block.
*/
function parseHtmlBlock(raw) {
	const match = BLOCK_RE.exec(raw);
	if (!match) return {
		text: raw,
		html: null
	};
	const body = (match[1] ?? "").replace(/\r\n/g, "\n");
	if (new TextEncoder().encode(body).length > MAX_HTML_BYTES || body.trim().length === 0) return {
		text: raw,
		html: null
	};
	return {
		text: (raw.slice(0, match.index) + raw.slice(match.index + match[0].length)).replace(/\n{3,}/g, "\n\n").trim(),
		html: body
	};
}
/** The prompt section that teaches the html block and the in-frame bridge
* API. Apps append it behind the user's request in experiment-style modes;
* a test keeps it covering the load-bearing rules. */
const HTML_PROMPT = [
	"- This conversation is in experiment mode: the user has explicitly asked for bespoke generated pages. Default to answering with one — reach for it whenever the reply benefits from layout, styling, or interaction. Plain prose alone is right only when there is genuinely nothing to show (a yes/no, a pure opinion).",
	"- Lead with a sentence or two of prose when context helps, then end the message with one fenced block containing a complete HTML document:",
	"  ```agent-html",
	"  <!doctype html>",
	"  <html><head><style>/* all styles inline here */</style></head>",
	"  <body>…<script>/* behavior last */<\/script></body></html>",
	"  ```",
	"- The client renders the document in a sandboxed frame *while it streams*, top to bottom. Put one <style> tag in <head> before any body content so partial pages are styled from the first paint; put <script> tags at the very end of <body> — they run once the document is complete, never against a half-built DOM.",
	`- The frame exposes window.AgentBridge. Calling AgentBridge.send("text") submits that text (max ${HTML_SEND_MAX} chars) as the user's next chat message — wire buttons, forms, and selections to it for anything that should continue the conversation. There is no other host API; do not use fetch, XHR, or navigation.`,
	"- The frame loads no external resources: no CDN scripts, stylesheets, or fonts — inline everything. Images may use https URLs.",
	"- Design mobile-first (~390px wide) and theme-aware: the host defines CSS variables --background, --foreground, --muted, --accent, and --border on :root and updates them when the app's light/dark theme changes — build your palette from them (e.g. color-mix with a fixed hue) instead of hardcoding page-wide colors.",
	"- Never invent data to fill a page: render the real values you have, fetching or computing them first when tools allow. When the data genuinely isn't available, say so instead of rendering placeholders."
].join("\n");
//#endregion
export { isTerminalEvent as C, PROTOCOL_VERSION as S, VIEW_BLOCK_NAME as _, parseQuestionBlock as a, validateControls as b, parseViewBlock as c, CONTROLS_BLOCK_NAME as d, HTML_BLOCK_NAME as f, QUESTION_PROMPT as g, QUESTION_BLOCK_NAME as h, parseHtmlFrameMessage as i, validateViewComponent as l, LEGACY_QUESTION_BLOCK_NAME as m, HTML_SEND_MAX as n, VIEW_CATALOG as o, LEGACY_CONTROLS_BLOCK_NAME as p, parseHtmlBlock as r, VIEW_PROMPT as s, HTML_PROMPT as t, validateViewSpec as u, initialControlValues as v, valuesEqual as x, parseControlsBlock as y };

//# sourceMappingURL=html-CsaMH8jY.js.map