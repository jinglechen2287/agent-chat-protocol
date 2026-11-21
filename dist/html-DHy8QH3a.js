import * as z from "zod";
//#region src/title-text.ts
/** Widest a chat title gets, in UTF-16 units. */
const CHAT_TITLE_MAX_LENGTH = 60;
/** Widest an `overarchingTask` or `pivotCandidate` summary gets. */
const CHAT_TITLE_TASK_MAX_LENGTH = 400;
/** Recent messages a host sends as title context unless it says otherwise. */
const CHAT_TITLE_RECENT_MESSAGE_LIMIT = 12;
/**
* Cuts to `max` UTF-16 units without splitting a surrogate pair: half an
* emoji renders as a replacement glyph wherever the value is shown, and
* survives into whatever the host persists.
*/
function truncateAt(value, max) {
	if (value.length <= max) return value;
	const cut = max - 1;
	const lead = value.charCodeAt(cut - 1);
	const trail = value.charCodeAt(cut);
	const splitsPair = lead >= 55296 && lead <= 56319 && trail >= 56320 && trail <= 57343;
	return `${value.slice(0, splitsPair ? cut - 1 : cut).trimEnd()}…`;
}
/** The first line of `text` with content, trimmed, or `undefined`. */
function firstLine(text) {
	return text.split("\n").map((line) => line.trim()).find(Boolean);
}
/** Wrapping quote pairs a model puts around a title. */
const QUOTE_PAIRS = [
	["\"", "\""],
	["'", "'"],
	["`", "`"],
	["“", "”"]
];
/** Bounds a chat title to {@link CHAT_TITLE_MAX_LENGTH}. Exported so a host
* deriving its own offline title (the first line of a message, say) lands on
* the same width as a generated one instead of re-deriving the bound. */
function truncateChatTitle(title) {
	return truncateAt(title, 60);
}
/**
* Strip a wrapping markdown code fence, tolerating any info string
* (```json, ```JSON, ```javascript), CRLF line endings, and a missing
* newline before the closing fence. Internal: the generator uses it on model
* output, and it is not part of the published surface.
*/
function stripCodeFence(raw) {
	return raw.trim().replace(/^```[^\n]*\r?\n?/, "").replace(/\r?\n?```$/, "").trim();
}
/** Reduces model or host text to a single bounded title line, or `undefined`
* when nothing usable is left. */
function normalizeChatTitle(raw) {
	let title = stripCodeFence(raw);
	title = firstLine(title) ?? "";
	title = title.replace(/^title\s*:\s*/i, "").trim();
	for (const [open, close] of QUOTE_PAIRS) if (title.startsWith(open) && title.endsWith(close)) {
		title = title.slice(open.length, -close.length).trim();
		break;
	}
	title = title.replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
	return title ? truncateChatTitle(title) : void 0;
}
/**
* Bounds a task summary to {@link CHAT_TITLE_TASK_MAX_LENGTH}, collapsing
* whitespace and reporting an empty one as absent. Exported because a host
* that stores the generator's task state has to bound it the same way on the
* way in — the prompt budgets against this length, so a host that invents its
* own can quietly feed back more context than the generator planned for.
*
* @deprecated Only the per-turn `createChatTitleGenerator` keeps task state.
*/
function normalizeTaskSummary(raw) {
	const summary = raw.trim().replace(/\s+/g, " ");
	if (!summary) return void 0;
	return truncateAt(summary, 400);
}
/** The title shown before (or instead of) a generated one: the first non-empty
* line of the request, an image name, or a constant. */
function fallbackChatTitle(prompt, attachmentNames = []) {
	const line = firstLine(prompt);
	if (line) return truncateChatTitle(line);
	return attachmentNames[0] ? truncateChatTitle(`Image: ${attachmentNames[0]}`) : "New thread";
}
function toChatTitleMessages(messages, limit = 12, project) {
	const recent = [];
	for (let index = messages.length - 1; index >= 0 && recent.length < limit; index -= 1) {
		const raw = messages[index];
		if (raw === void 0 || raw === null) continue;
		const message = project ? project(raw) : raw;
		if (!message || message.text.trim() === "") continue;
		recent.push({
			role: message.role === "user" ? "user" : "assistant",
			text: message.text
		});
	}
	return recent.reverse();
}
//#endregion
//#region src/events.ts
/**
* Version of this event contract. Servers include it on `session_started` so
* clients replaying buffered events across a deploy can detect skew.
*/
const PROTOCOL_VERSION = 14;
/** True for the three events that end a turn's stream: `done`, `aborted`,
* `error`. After one of these, no further events arrive for the turn. */
function isTerminalEvent(ev) {
	return ev.type === "done" || ev.type === "aborted" || ev.type === "error";
}
/**
* Builds a sparse `thread_title` event: a non-empty string is stated, an
* explicit `null` clears, and an empty or missing field is left off the event
* — no statement, the client keeps what it has. Right for a server that
* persists title state itself and only announces renames. A server whose
* client owns the state needs {@link threadTitleSnapshotEvent} instead: a
* sparse event would strand a dropped field on the client forever.
*/
function threadTitleEvent(state) {
	return {
		type: "thread_title",
		title: state.title,
		...state.overarchingTask || state.overarchingTask === null ? { overarchingTask: state.overarchingTask } : {},
		...state.pivotCandidate || state.pivotCandidate === null ? { pivotCandidate: state.pivotCandidate } : {}
	};
}
/**
* Builds the complete `thread_title` snapshot a server MUST emit when its
* client owns the title state: both task fields are always present, a dropped
* or empty one stated as an explicit `null` so the client clears it. Accepts
* a `ChatTitleResult` directly.
*/
function threadTitleSnapshotEvent(state) {
	return {
		type: "thread_title",
		title: state.title,
		overarchingTask: state.overarchingTask || null,
		pivotCandidate: state.pivotCandidate || null
	};
}
//#endregion
//#region src/block.ts
/**
* The steps every generative-UI block parser shares: find the first block,
* decode its body, and cut it out of the surrounding prose. Internal: not
* re-exported from either entry.
*/
let encoder;
/** Size of `text` in UTF-8 bytes, the unit every block ceiling is set in. The
* encoder is made on first use, so importing the package doesn't need a global
* `TextEncoder` until a parser measures something. */
function utf8Length(text) {
	if (!encoder) encoder = new TextEncoder();
	return encoder.encode(text).length;
}
/**
* A finder from a grammar split at the end of its opening line: `open`
* (global) finds the opening line, and `rest` (sticky) matches the body,
* group 1, and the closing line from where the opening ends.
*
* Only the first opener is tried. Any closer after a later opener also comes
* after the first, and the body may span opener lines, so if any opener
* matches the first one does: the result equals an unanchored search, without
* the unanchored search's restart at every opener, which made a run of
* unclosed openers cost time quadratic in the message length.
*/
function splitPatternFinder(open, rest) {
	return (raw) => {
		open.lastIndex = 0;
		const opening = open.exec(raw);
		if (!opening) return null;
		rest.lastIndex = opening.index + opening[0].length;
		const tail = rest.exec(raw);
		if (!tail) return null;
		return {
			index: opening.index,
			end: rest.lastIndex,
			body: tail[1] ?? ""
		};
	};
}
const FENCE = "```";
/**
* Where one line of a fenced block, its "\r" already stripped, closes the
* block, or null when it doesn't. The completed parser and the streamer both
* ask this, so they can't disagree about where a block ends.
*
* - A line holding only ``` closes any block, whitespace around it allowed
*   (the whitespace `trim()` removes), and the whole line goes with it.
* - With `json`, for blocks whose body is JSON (question, controls, view),
*   the first ``` outside a JSON string closes the block too, wherever it sits
*   on the line: what precedes it is the last of the body, and what follows
*   it stays prose. A ``` inside a string, such as a code fence in a Markdown
*   component's value, never closes the block, unless the string is still
*   open at the end of the line, which no valid JSON is.
*
* `bodyTail` is the part of the line that belongs to the body; `end` is where
* the block ends within the line.
*/
function closingLine(line, json) {
	if (line.trim() === FENCE) return {
		bodyTail: "",
		end: line.length
	};
	if (!json) return null;
	let inString = false;
	for (let i = 0; i < line.length; i += 1) {
		const char = line[i];
		if (inString) {
			if (char === "\\") i += 1;
			else if (char === "\"") inString = false;
		} else if (char === "\"") inString = true;
		else if (char === "`" && line.startsWith(FENCE, i)) {
			const after = i + 3;
			return {
				bodyTail: line.slice(0, i),
				end: line.slice(after).trim() === "" ? line.length : after
			};
		}
	}
	const trimmed = line.trimEnd();
	if (inString && trimmed.endsWith(FENCE)) return {
		bodyTail: trimmed.slice(0, -3),
		end: line.length
	};
	return null;
}
/**
* The info string of an opening fence line, by the completed parser's rule:
* the text right after the ``` up to trailing whitespace. Leading whitespace
* stays, so "``` agent-view" names no agent block in either the parser or the
* streamer.
*/
function fenceInfo(afterFence) {
	let end = afterFence.length;
	if (afterFence[end - 1] === "\r") end -= 1;
	while (end > 0 && isLineSpace(afterFence[end - 1])) end -= 1;
	return afterFence.slice(0, end);
}
/** Whitespace that doesn't end a line. */
function isLineSpace(char) {
	return char !== "\r" && char !== "\n" && /\s/.test(char);
}
/**
* The finder for the first fenced block whose info string is exactly one of
* `names` (trailing spaces allowed), so an ordinary ```json block never
* matches. The opening fence starts a line, after optional spaces or tabs (an
* indented list item), as the streamer requires too; a fence mentioned
* mid-sentence stays prose. The block ends at the first line
* {@link closingLine} accepts, read one line at a time, so a ``` in the
* middle of a line (a code fence inside a JSON string, a JS template literal)
* never ends it early.
*/
function fencedBlockFinder(names, json) {
	const info = names.length === 1 ? names[0] : `(?:${names.join("|")})`;
	const open = new RegExp("(^|\\n)([ \\t]*)```" + info + "[^\\S\\r\\n]*\\r?\\n", "g");
	return (raw) => {
		open.lastIndex = 0;
		const opening = open.exec(raw);
		if (!opening) return null;
		const bodyStart = opening.index + opening[0].length;
		for (let lineStart = bodyStart;;) {
			const newline = raw.indexOf("\n", lineStart);
			const lineEnd = newline === -1 ? raw.length : newline;
			const close = closingLine(raw.slice(lineStart, lineEnd).replace(/\r$/, ""), json);
			if (close) {
				const lines = raw.slice(bodyStart, lineStart);
				const body = close.bodyTail === "" ? lines.replace(/\r?\n$/, "") : lines + close.bodyTail;
				return {
					index: opening.index + opening[1].length + opening[2].length,
					end: lineStart + close.end,
					body
				};
			}
			if (newline === -1) return null;
			lineStart = newline + 1;
		}
	};
}
/**
* `raw` with the block cut out. Removing a block from the middle of a message
* leaves the blank lines that bracketed it stacked together, so those collapse
* to one blank line and the result is trimmed.
*/
function withoutBlock(raw, block) {
	return (raw.slice(0, block.index) + raw.slice(block.end)).replace(/\n{3,}/g, "\n\n").trim();
}
/**
* Finds the first block and decodes its body. A block that `decode` rejects
* with null stays in the prose as plain text: a slightly raw message beats a
* dropped one.
*/
function extractBlock(raw, find, decode) {
	const block = find(raw);
	if (!block) return {
		text: raw,
		value: null
	};
	const value = decode(block.body);
	if (value === null) return {
		text: raw,
		value: null
	};
	return {
		text: withoutBlock(raw, block),
		value
	};
}
//#endregion
//#region src/guards.ts
/**
* Type guards and object helpers shared by the validators. Internal: not
* re-exported from either entry.
*/
/**
* Whether `key` is an own property of `object`, so a lookup by an untrusted
* key can't land on an inherited member such as `constructor` or
* `__proto__`. Spelled out instead of `Object.hasOwn`, which the client entry
* can't assume: it runs in browsers older than Safari 15.4 and Chrome 93.
*/
function hasOwn(object, key) {
	return Object.prototype.hasOwnProperty.call(object, key);
}
/** A plain object: not null, not an array. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** A string with at least one non-whitespace character. */
function hasText(value) {
	return typeof value === "string" && value.trim() !== "";
}
/** A string other than `""`. Whitespace counts. */
function isNonEmptyString(value) {
	return typeof value === "string" && value !== "";
}
/** A non-negative safe integer: a message index, a count, a byte size. */
function isIndex(value) {
	return Number.isSafeInteger(value) && value >= 0;
}
/**
* A guard for one member of a string union. Taking a `Record` instead of a
* list makes the compiler demand every member, so the guard cannot fall
* behind the union it checks.
*/
function memberOf(members) {
	return (value) => typeof value === "string" && hasOwn(members, value);
}
/**
* Copies `props` without its `undefined`-valued keys, in the same order. Under
* `exactOptionalPropertyTypes` an optional field must be absent rather than
* `undefined`; this states that once instead of a conditional spread per field.
*/
function definedProps(props) {
	const out = {};
	for (const key of Object.keys(props)) if (props[key] !== void 0) out[key] = props[key];
	return out;
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
/** Tells a turn with full access that limits set by earlier turns' modes are
* over. A host only needs it on a conversation that has had a restricted turn. */
const BUILD_PROMPT = "You are in Build mode: limits from earlier turns' modes no longer apply.";
/** Teaches a plan-mode turn its output contract: research freely, change
* nothing, and end the final message with a `<proposed_plan>` block that the
* client lifts into a plan card (see plan.ts for the parse side).
*
* Written for headless turns on either provider. Claude runs it in the `plan`
* permission mode, where a headless session has no approval channel behind
* ExitPlanMode (without this contract the model hunts for it); Codex runs it
* under a read-only sandbox policy. The prompt is what aligns both on one
* plan-delivery channel. */
const PLAN_PROMPT = [
	"## Plan mode",
	"",
	"This turn produces a plan, not changes: treat every request, however imperative, as a request to plan the work.",
	"",
	"Read, search, and run non-mutating commands to make the plan accurate. Explore before asking; ask only what exploration can't answer. Don't edit files, apply patches, or run formatters or codegen.",
	"",
	"Don't call ExitPlanMode, since nothing is behind it, and don't write the plan to a file.",
	"",
	"When nothing is left for the implementer to decide, end your final message with one block, each tag on its own line and markdown inside:",
	"",
	"<proposed_plan>",
	"# Clear title",
	"",
	"Brief summary, the concrete changes (files, interfaces, code where it helps), how to verify, and any assumptions you chose.",
	"</proposed_plan>",
	"",
	"Don't ask \"should I proceed?\" afterwards; the client offers to implement it."
].join("\n");
/** Teaches a chat-mode turn its contract: it can read, search, and run commands
* but not edit files. The host enforces that: a Claude host with a tool guard on
* the file tools and an OS sandbox on the shell, Codex with a read-only turn
* sandbox. It uses the question block, so a host sends {@link QUESTION_PROMPT}
* too. No parse side exists: the reply is ordinary assistant text. */
const CHAT_PROMPT = [
	"## Chat mode",
	"",
	"You can read, search, and run commands, but not edit files by any route: file tools, shell, or MCP.",
	"",
	"If an action is blocked, don't work around it: ask with a question block whose approve option names the exact action."
].join("\n");
/** Teaches the clarifying-question block. Framework- and DOM-agnostic. */
const QUESTION_PROMPT = [
	"- If the request is genuinely ambiguous (multiple reasonable interpretations), ask instead of guessing, and don't make edits that turn. Otherwise apply the change directly.",
	"- When a clarifying question has a small, fixed set of answers, end your message with a question block so the user can answer in one click:",
	`  \`\`\`${QUESTION_BLOCK_NAME}`,
	"  {\"question\": \"Short question?\", \"options\": [\"First choice\", \"Second choice\"]}",
	"  ```",
	"  The user's pick (or a typed reply) arrives as the next message.",
	"- When you need several answers, ask them all in one block rather than one per turn, and add `\"multi\": true` to a question that takes more than one pick:",
	`  \`\`\`${QUESTION_BLOCK_NAME}`,
	"  {\"questions\": [{\"question\": \"First question?\", \"options\": [\"A\", \"B\"]}, {\"question\": \"Second question?\", \"options\": [\"C\", \"D\", \"E\"], \"multi\": true}]}",
	"  ```",
	"  The user can also type their own answer to any question. The answers arrive together as the next message, one numbered line per question, such as `1. First question? → A`, with `(skipped)` for one they left.",
	"- Emit at most one block, as the very last thing in the message, with 1–6 short option labels per question. If an answer isn't a small fixed set of choices, just ask in plain text."
].join("\n");
//#endregion
//#region src/controls.ts
/**
* Shared schema + helpers for the ```agent-controls``` block: the structured
* parameter panel an agent can emit at the end of a message (mirroring
* ```agent-question```).
*
* The shared contract covers the *widgets*: typed controls (slider / color /
* select), their validation, and the current-values model. Anything beyond
* that — carve's CSS style bindings and scopes, for example — is an app
* extension: extra fields on the block that the core validator ignores, and
* that an app-supplied validator (the `validate` parameter of
* `parseControlsBlock`, the bridge's `controlsValidator` option, the
* `mapEvent` option of `consumeSseResponse`) lifts into a richer spec. A
* client that doesn't understand an extension renders the widgets and the
* Apply round-trip and ignores the rest.
*
* The legacy `carve-controls` fence is accepted during migration.
*/
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
	if (!isRecord(value)) return null;
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
	if (!isRecord(value)) return null;
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
				...definedProps({
					step: stepOut,
					unit
				}),
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
const findBlock$4 = fencedBlockFinder([CONTROLS_BLOCK_NAME, LEGACY_CONTROLS_BLOCK_NAME], true);
function parseControlsBlock(raw, validate = validateControls) {
	const { text, value } = extractBlock(raw, findBlock$4, (body) => {
		let parsed;
		try {
			parsed = JSON.parse(body.trim());
		} catch {
			return null;
		}
		return validate(parsed);
	});
	return {
		text,
		controls: value
	};
}
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
/** A child reference: the same shape as the id it points at. */
const ref = id;
const bind = z.string().regex(BIND_RE);
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
			bind,
			label,
			placeholder: shortText.optional(),
			value: shortText.optional()
		}),
		prompt: "Input {bind: $var, label, placeholder?, value?} — free text"
	},
	Select: {
		schema: component("Select", {
			bind,
			label,
			options: z.array(z.string().min(1).max(80)).min(2).max(24),
			value: z.string().max(80)
		}),
		prompt: "Select {bind: $var, label, options[], value}"
	},
	Slider: {
		schema: component("Slider", {
			bind,
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
			bind,
			label,
			checked: z.boolean().optional()
		}),
		prompt: "Checkbox {bind: $var, label, checked?}"
	},
	DateRange: {
		schema: component("DateRange", {
			bind,
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
	if (!isRecord(value)) return null;
	const { type } = value;
	if (typeof type !== "string") return null;
	if (!hasOwn(VIEW_CATALOG, type)) return null;
	const parsed = VIEW_CATALOG[type].schema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
/** The ids a component renders as children, in slot order. */
function childRefs(c) {
	if ("children" in c) return c.children;
	if (c.type === "Tabs") return c.items.flatMap((item) => item.children);
	return [];
}
/** Returns a copy of the component keeping only child refs in `keep`, each
* once across all of its slots, in first-occurrence order. */
function withPrunedRefs(c, keep) {
	const seen = /* @__PURE__ */ new Set();
	const prune = (refs) => refs.filter((child) => {
		if (seen.has(child) || !keep(child)) return false;
		seen.add(child);
		return true;
	});
	if ("children" in c) return {
		...c,
		children: prune(c.children)
	};
	if (c.type === "Tabs") return {
		...c,
		items: c.items.map((item) => ({
			...item,
			children: prune(item.children)
		}))
	};
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
	if (!isRecord(value)) return null;
	const raw = value.components;
	if (!Array.isArray(raw)) return null;
	const byId = /* @__PURE__ */ new Map();
	for (const entry of raw.slice(0, MAX_VALIDATED_ENTRIES)) {
		const parsed = validateViewComponent(entry);
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
const findBlock$3 = fencedBlockFinder([VIEW_BLOCK_NAME], true);
/** One block line as JSON. A line that doesn't parse is reported apart from
* one that parses to `null`, since only parsed values count toward
* {@link MAX_VALIDATED_ENTRIES}. */
function parseJsonLine(line) {
	try {
		return {
			ok: true,
			value: JSON.parse(line)
		};
	} catch {
		return { ok: false };
	}
}
/**
* Extracts the first ```agent-view``` block: one JSON component per line.
* Malformed or unknown lines are skipped; a block with no valid root (or one
* over the size ceiling) is left in the prose as plain text, exactly like a
* malformed controls block.
*/
function parseViewBlock(raw) {
	const { text, value } = extractBlock(raw, findBlock$3, (body) => {
		if (utf8Length(body) > MAX_BLOCK_BYTES) return null;
		const components = [];
		for (const line of body.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const parsed = parseJsonLine(trimmed);
			if (parsed.ok) components.push(parsed.value);
		}
		return validateViewSpec({ components });
	});
	return {
		text,
		view: value
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
/**
* The structured clarifying-question block an agent can end a message with:
*
*   ```agent-question
*   {"question": "Which nav style?", "options": ["Sidebar", "Top bar"]}
*   ```
*
* or, to ask several things at once, a list of them — each may set
* `"multi": true` to take more than one option:
*
*   ```agent-question
*   {"questions": [
*     {"question": "Which nav style?", "options": ["Sidebar", "Top bar"]},
*     {"question": "Which pages?", "options": ["Home", "Docs"], "multi": true}
*   ]}
*   ```
*
* When present and well-formed the block is lifted into a `QuestionSpec` and
* stripped from the surrounding prose. A malformed block is left untouched as
* plain text — showing the user a slightly raw message beats dropping it.
*
* The legacy `carve-question` fence is accepted during migration.
*/
/** Upper bound on rendered option chips — the agent is asked for 2–6; this is
* a defensive ceiling so a runaway block can't flood the client. */
const MAX_OPTIONS = 8;
/** Defensive length ceilings against a runaway block, not a style rule: an option that explains itself in a sentence or two still renders, since cards wrap long labels. Over-length questions invalidate the block; over-length options are skipped. */
const MAX_QUESTION_LENGTH = 500;
const MAX_OPTION_LENGTH = 500;
const findBlock$2 = fencedBlockFinder([QUESTION_BLOCK_NAME, LEGACY_QUESTION_BLOCK_NAME], true);
function parseQuestionBlock(raw) {
	const { text, value } = extractBlock(raw, findBlock$2, parseBlockBody);
	return {
		text,
		question: value
	};
}
function parseBlockBody(body) {
	let parsed;
	try {
		parsed = JSON.parse(body.trim());
	} catch {
		return null;
	}
	if (!isRecord(parsed)) return null;
	const obj = parsed;
	const raw = "questions" in obj ? obj.questions : [obj];
	if (!Array.isArray(raw) || raw.length === 0) return null;
	const items = [];
	for (const entry of raw) {
		const item = parseItem(entry);
		if (!item) return null;
		items.push(item);
	}
	const [first, ...rest] = items;
	return rest.length > 0 || first.multi === true ? {
		...first,
		questions: items
	} : first;
}
function parseItem(entry) {
	if (!isRecord(entry)) return null;
	const obj = entry;
	if (typeof obj.question !== "string") return null;
	const question = obj.question.trim();
	if (!question || question.length > MAX_QUESTION_LENGTH) return null;
	if (obj.multi !== void 0 && typeof obj.multi !== "boolean") return null;
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
	if (options.length < 1) return null;
	return obj.multi === true ? {
		question,
		options,
		multi: true
	} : {
		question,
		options
	};
}
/** Text on one line: line breaks and runs of spaces become one space. */
function oneLine(text) {
	return text.replace(/\s+/g, " ").trim();
}
/**
* A form card's reply, as the next user turn: one numbered line per question,
* `1. Question → Answer`, several answers joined by `; `, and `(skipped)` for
* a question left unanswered. `answers[i]` holds question `i`'s picked labels
* and any typed text; blank ones are dropped.
*/
function formatQuestionAnswers(items, answers) {
	return items.map((item, index) => {
		const picked = (answers[index] ?? []).map(oneLine).filter(Boolean);
		return `${index + 1}. ${oneLine(item.question)} → ${picked.length > 0 ? picked.join("; ") : "(skipped)"}`;
	}).join("\n");
}
//#endregion
//#region src/plan.ts
/**
* The proposed-plan block a plan-mode agent ends its final message with:
*
*   <proposed_plan>
*   # Add subtract to a.ts
*   ...markdown...
*   </proposed_plan>
*
* When present and well-formed the block is lifted into a `PlanSpec` and
* stripped from the surrounding prose. A malformed or unclosed block is left
* untouched as plain text — a raw plan in the transcript beats dropping it.
*
* Tags, not a fenced block, deliberately: plan markdown legitimately contains
* code fences, and an inner ``` would close an outer fence. XML-ish tags have
* no such collision, stream invisibly through markdown renderers that drop
* unknown HTML, and match the `<proposed_plan>` convention Codex is already
* trained on.
*/
/** Defensive ceiling on the plan body, in UTF-8 bytes. Plans are long-form documents, and a host may ask for one as a complete HTML page, so this matches the html block's ceiling; it only exists so a runaway generation can't flood clients through one event. */
const MAX_PLAN_BYTES = 262144;
/** Matches the first plan block. Both tags must sit on their own line
* (surrounding whitespace allowed) so an inline mention of the tag in prose
* is never mistaken for a block. Non-greedy: stops at the first closing tag. */
const findBlock$1 = splitPatternFinder(/(?:^|\n)[^\S\r\n]*<proposed_plan>[^\S\r\n]*\r?\n/g, /(?:([\s\S]*?)\r?\n)??[^\S\r\n]*<\/proposed_plan>[^\S\r\n]*\r?(?=\n|$)/y);
/** The first ATX heading in the plan markdown, used as the card title.
* Scans line by line so `# comment` lines inside fenced code blocks are never
* mistaken for headings; per CommonMark, only a closing marker of the same
* character and at least the opening's length ends a fence. */
function planTitle(planMarkdown) {
	let fence = null;
	for (const line of planMarkdown.split(/\r\n|\n|\r/)) {
		const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (marker) {
			const rest = line.slice(line.indexOf(marker) + marker.length);
			if (!fence) {
				if (marker[0] === "~" || !rest.includes("`")) fence = {
					char: marker[0],
					length: marker.length
				};
			} else if (marker[0] === fence.char && marker.length >= fence.length && /^[ \t]*$/.test(rest)) fence = null;
			continue;
		}
		if (fence) continue;
		const heading = /^ {0,3}#{1,6}(?:[ \t]+(.*))?$/.exec(line)?.[1]?.replace(/(?:^[ \t]*|[ \t]+)#+[ \t]*$/, "").trim();
		if (heading && heading.length > 0) return heading;
	}
	return null;
}
function parseProposedPlan(raw) {
	const { text, value } = extractBlock(raw, findBlock$1, (body) => {
		const planMarkdown = body.replace(/\r\n/g, "\n").trim();
		if (!planMarkdown || utf8Length(planMarkdown) > MAX_PLAN_BYTES) return null;
		return {
			planMarkdown,
			title: planTitle(planMarkdown)
		};
	});
	return {
		text,
		plan: value
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
	if (!isRecord(data)) return null;
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
/** Finds the first agent-html fenced block. The closing fence must sit alone
* on its own line (optional surrounding whitespace) so backticks inside the
* document, a JS template literal or a ```js example line, cannot end the
* block early. */
const findBlock = fencedBlockFinder([HTML_BLOCK_NAME], false);
/**
* Extracts the first ```agent-html``` block. An empty or oversized block is
* left in the prose as plain text, exactly like a rootless view block.
*/
function parseHtmlBlock(raw) {
	const { text, value } = extractBlock(raw, findBlock, (rawBody) => {
		const body = rawBody.replace(/\r\n/g, "\n");
		return utf8Length(body) > MAX_HTML_BYTES || body.trim().length === 0 ? null : body;
	});
	return {
		text,
		html: value
	};
}
//#endregion
export { isIndex as A, CHAT_TITLE_MAX_LENGTH as B, PLAN_PROMPT as C, definedProps as D, VIEW_BLOCK_NAME as E, fenceInfo as F, normalizeTaskSummary as G, CHAT_TITLE_TASK_MAX_LENGTH as H, PROTOCOL_VERSION as I, truncateChatTitle as J, stripCodeFence as K, isTerminalEvent as L, isRecord as M, memberOf as N, hasOwn as O, closingLine as P, threadTitleEvent as R, LEGACY_QUESTION_BLOCK_NAME as S, QUESTION_PROMPT as T, fallbackChatTitle as U, CHAT_TITLE_RECENT_MESSAGE_LIMIT as V, normalizeChatTitle as W, BUILD_PROMPT as _, formatQuestionAnswers as a, HTML_BLOCK_NAME as b, VIEW_PROMPT as c, validateViewComponent as d, validateViewSpec as f, valuesEqual as g, validateControls as h, parseProposedPlan as i, isNonEmptyString as j, hasText as k, parseJsonLine as l, parseControlsBlock as m, parseHtmlBlock as n, parseQuestionBlock as o, initialControlValues as p, toChatTitleMessages as q, parseHtmlFrameMessage as r, VIEW_CATALOG as s, HTML_SEND_MAX as t, parseViewBlock as u, CHAT_PROMPT as v, QUESTION_BLOCK_NAME as w, LEGACY_CONTROLS_BLOCK_NAME as x, CONTROLS_BLOCK_NAME as y, threadTitleSnapshotEvent as z };

//# sourceMappingURL=html-DHy8QH3a.js.map