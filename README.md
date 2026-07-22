# agent-chat-protocol

A framework-agnostic contract for rendering an agent turn as a live, interactive chat: the streaming event grammar, the SSE codec, the generative-UI vocabulary, and the rendering rules that make them mean something.

Sits between [`agent-cli-runner`](https://github.com/jinglechen2287/agent-cli-runner) (spawns the Claude Code / Codex CLIs and streams callbacks) and each app's own rendering layer. Multiple frontends — a SolidJS studio, a React phone app, a Telegram bot — implement this one contract and deliver the same chat UX without re-deriving the protocol.

```
Layer 3 — Rendering (per app: SolidJS / React / bot — not in this package)
Layer 2 — agent-chat-protocol   ← this package
Layer 1 — agent-cli-runner      (CLI subprocess runtime)
```

## Install

```jsonc
// package.json
"dependencies": {
  "agent-chat-protocol": "github:jinglechen2287/agent-chat-protocol"
}
```

`dist/` is committed, so a `github:` install is build-free. Two entry points:

- `agent-chat-protocol` — **client-safe**: event types, SSE codec, question/controls parsers + validators, prompt sections. No Node-only imports; safe in browser bundles.
- `agent-chat-protocol/server` — **server-only glue**: the runner→events bridge, the reattachable turn store, tool-detail projection, and opt-in chat-title orchestration. Peer-depends on `agent-cli-runner`.

## The event contract

A turn is a stream of `ChatStreamEvent`s. Protocol version: `PROTOCOL_VERSION = 7` (servers include it on `session_started`).

| Event | Payload | Terminal |
| --- | --- | --- |
| `session_started` | `sessionId`, `protocolVersion?` | |
| `assistant_text` | `text` | |
| `assistant_text_delta` | `index`, `delta` | Best-effort fragments of the message `assistant_text` will deliver; never persisted. |
| `tool_use` | `name`, `summary?`, `details?: {label, value}[]`, `task?`, `plan?` | `task` correlates task-management calls by ID; `plan` carries Codex step/status snapshots. |
| `question` | `question`, `options: string[]` | |
| `plan` | `planMarkdown`, `title: string \| null` | A proposed implementation plan (a `<proposed_plan>` block body) from a plan-mode turn. |
| `controls` | `spec: ControlsSpec` | |
| `view` | `spec: ViewSpec` | A generative-UI view composed from the shared component catalog. |
| `view_line` | `index`, `component` | Best-effort fragments of the view a `view` event will deliver; never persisted. |
| `html` | `content` | A freeform generated page (an ` ```agent-html ` block body), rendered in a sandboxed frame. |
| `html_delta` | `index`, `delta` | Best-effort newline-terminated fragments of the page an `html` event will deliver; never persisted. |
| `context_usage` | `contextTokens`, `contextWindow?`, `model?` | |
| `thread_title` | `title` | |
| `background_agent_updated` | `agent: BackgroundAgent` | |
| `stderr` | `chunk` | |
| `done` | `exitCode` | ✓ |
| `aborted` | `reason?: "user" \| "timeout"` | ✓ |
| `error` | `message` | ✓ |

Exactly one terminal event ends every turn (`isTerminalEvent` tells you which ones those are). Unknown event names and malformed payloads decode to `null` — clients skip them, which is what keeps the stream forward-compatible.

### Rendering contract (normative)

What a conforming client MUST do per event. The same text lives as TSDoc on the `ChatStreamEvent` union, so it's in your editor at the point of use.

- **`session_started`** — persist `sessionId` and send it with the next turn request to continue the conversation. A second occurrence with a different id supersedes the first. Not emitted on resumed turns (the client already holds the id it resumed with).
- **`assistant_text`** — render as sanitized GitHub-flavored markdown. Multiple occurrences are separate messages in order, not fragments to concatenate.
- **`assistant_text_delta`** — append `delta` to a scratch buffer for `index` (assistant messages within the turn, counted from 0) and MAY render that buffer as in-progress prose. Discard the buffer when the `assistant_text` for the same index arrives: that event is the transcript message and a fragment buffer is never one, so it MUST NOT be persisted or counted as a replayed message. Fragments are best-effort — they stop at a generative-UI block so its raw markup never precedes the rendered card, and a turn may deliver an `assistant_text` with no preceding fragments at all.
- **`tool_use`** — show at least `name` inline in the transcript, in stream order relative to text (this is the visible tool trace: "Read `api.ts`", "Bash `bun test`"). `summary` is an optional concise description and `details` are optional curated label/value metadata. Task-management calls may also carry `task: { id?, subject?, status? }`, allowing clients to resolve a later update to the earlier task subject. Codex plan updates may carry `plan: { text, status }[]`; clients can render every step while `details` provides the provider-neutral expanded rows. A client MUST preserve every event and its stream order. No tool output is carried — this traces what ran, not results.
- **`question`** — render `options` as selectable choices. The chosen option's label (or a typed free-text reply) is sent **verbatim as the next user turn** — there is no special reply channel. Selecting marks the card answered locally.
- **`plan`** — a proposed implementation plan from a plan-mode turn: the body of a `<proposed_plan>` block, lifted by `parseProposedPlan` and stripped from the surrounding prose. Render `planMarkdown` as sanitized GitHub-flavored markdown (like `assistant_text`, it is agent output — unsafe raw HTML and URL schemes must not reach the DOM), ideally as a distinct plan card (`title` is the plan's first heading, for compact headers). Offer the round-trip `PLAN_PROMPT` promises the agent: user feedback is sent as a further plan-mode turn to refine the plan, and an approval sends the plan text back **verbatim** as an implement request outside plan mode — the plan travels in the message, so implementation does not depend on session memory. The event is a transcript message alongside `assistant_text`. Tags rather than a fence, deliberately: plan markdown legitimately contains code fences, and unknown-HTML-dropping markdown renderers keep the raw tag invisible while the plan streams as prose.
- **`controls`** — render each control as an input seeded with its `value` (`slider` → range input with `min`/`max`/`step`, `color` → color picker, `select` → dropdown). On Apply, send an **app-defined message composed from the final values** as the next user turn (carve composes CSS declarations; a simpler app can send `id: value` pairs). Apps may extend the spec with extra fields via the validator seams below — a client that doesn't understand an extension renders the widgets + Apply round-trip and ignores the rest. A panel is retired by the next user message, whatever it is.
- **`view`** — render known catalog components natively in graph order and skip unknown or invalid ones — the rest of the view still renders. The event is a transcript message alongside `assistant_text` (a view's surrounding prose is kept, unlike controls). Inputs bind view-local `$vars`; a Button's `message` template with `{$var}` tokens interpolated is sent verbatim as the next user turn, and `href` Buttons open externally (`noopener`). Views carry no handlers, no expressions, and no executable payloads — the catalog (`VIEW_CATALOG`) is the entire vocabulary, and `VIEW_PROMPT` is generated from it so prompt and validator cannot drift.
- **`view_line`** — one validated component of a view still being written, indexed like `assistant_text_delta`. Clients MAY hydrate a skeleton view from these and MUST discard them when the same message's `view` (or `assistant_text`) arrives — the completed event runs full graph validation, which per-line delivery cannot, so it is the authoritative render. Fragments stay out of the replay buffer; the store accumulates them (`pushViewLine` / `pendingViewLines`) and a late subscriber catches up after replay, exactly like text partials.
- **`html`** — a freeform generated page: the body of an ` ```agent-html ` block, the escape hatch for layouts and interactions the view catalog can't express. Clients MUST render it in a sandboxed frame (never inline in the app document) wired to the postMessage bridge in `html.ts`: the host sends `agent-html:update`/`agent-html:theme` frames in, and validates `agent-html:ready`/`agent-html:height`/`agent-html:send` frames out with `parseHtmlFrameMessage` — a frame runs agent-authored code, so its messages are untrusted input. An `agent-html:send` text is sent verbatim as the next user turn, the freeform twin of a view Button's `message` template. The event is a transcript message alongside `assistant_text`; surrounding prose is kept. `HTML_PROMPT` teaches the emit side (style-first streaming order, scripts last, the `AgentBridge.send` API) so prompt and bridge cannot drift. An empty or oversized block degrades to prose, exactly like a rootless view block.
- **`html_delta`** — a newline-terminated run of completed lines from an html block still being written, indexed like `assistant_text_delta`. Clients MAY append deltas to a scratch document and render it as a growing page (morphing, not re-executing — scripts wait for the completed event), and MUST discard the scratch when the same message's `html` (or `assistant_text`) arrives. Deltas stay out of the replay buffer; the store accumulates them (`pushHtmlDelta` / `pendingHtmlDeltas`) and a late subscriber catches up after replay, exactly like text partials.
- **`context_usage`** — a context-window usage snapshot; render the latest as a context meter (each occurrence supersedes the last). Show `contextTokens` against `contextWindow` when present, the raw count alone when absent. Counts are provider-reported and may be approximate — clamp the meter at 100% rather than treating overflow as an error.
- **`thread_title`** — replace the chat/thread title without adding a transcript message. The event is non-terminal and replayable like every other event.
- **`background_agent_updated`** — upsert the complete snapshot by `agent.id`, replacing the prior snapshot for that agent. Do not append progress heartbeats as transcript messages. Status is normalized to `pending`, `running`, `completed`, `failed`, or `interrupted`; provider-specific IDs, spawn correlation, progress, summary, errors, and timestamps remain available on the snapshot.
- **`stderr`** — diagnostic channel; MAY be ignored or surfaced in a collapsed log. Never render as assistant prose.
- **`done`** — the turn completed; `exitCode` 0 is success.
- **`aborted`** — killed before completing. Render `user` (deliberate cancel) and `timeout` (wall-clock limit) differently; absent reason means treat as `user`.
- **`error`** — the turn failed; `message` is human-readable and safe to show.

### Recommended tool-call presentation (non-normative)

The wire contract ends at the information carried by each `tool_use` event and its position in the stream. The following guidance helps clients present that information consistently without making a particular web, native, terminal, or bot layout part of the protocol:

- Keep `name` visible in the compact transcript trace. A collapsed client may omit `summary`, then reveal the summary or `details` once when expanded. Avoid repeating the same information in both the compact trace and expanded content; on narrow screens, stacking each detail label above its value is usually easier to scan than a two-column layout.
- A client MAY visually group consecutive `tool_use` events with the same `name` into a compact bundle such as `Read ×3`. The expansion should still expose every call's own summary or details. Grouping stops at any intervening event, including assistant text or a different tool call; clients should not reorder or merge non-consecutive events.
- Visual grouping is only a presentation heuristic. It does not imply semantic batching or parallel execution, and the client MUST preserve every event and its stream order in its underlying transcript state.
- Icon selection, colors, pill geometry, spacing, collapsed defaults, breakpoints, and animation remain Layer 3 application concerns.

If consumers eventually need to distinguish an intentional batch or a set of parallel calls, add an optional group identifier through a versioned protocol change rather than inferring that meaning from adjacency or matching names.

### Reconnect / replay

An in-flight turn is rebuilt by replaying its buffered events from the start and then continuing live — the server's turn store keeps the buffer (see `createTaskStore`), and a reattach endpoint replays `task.events` before subscribing. Because replay and live events are the same union in the same order, a client needs no special reattach rendering path: process events identically either way. Completed turns stay reattachable for a TTL so a refresh just after `done` still sees the terminal event.

The fragment events — `assistant_text_delta`, `view_line`, and `html_delta` — are kept **out** of that buffer. Buffering a fragment per token would make every reattach replay thousands of frames to rebuild content the eventual completed event supersedes anyway. Instead the store accumulates fragments per index (`pushPartial` / `pushViewLine` / `pushHtmlDelta`) and hands a late subscriber everything accumulated so far in compact form (`pendingPartials` / `pendingViewLines` / `pendingHtmlDeltas`), after the replay and before it goes live. Appending those to empty scratch buffers lands the reattaching client exactly where a continuously-connected one already is, so both still run one code path.

## SSE codec

Server side, one typed event becomes one wire frame:

```ts
import { encodeChatEvent } from "agent-chat-protocol";
res.write(encodeChatEvent({ type: "assistant_text", text: "hi" }));
// event: assistant_text\ndata: {"text":"hi"}\n\n
```

Client side, either drive the whole response:

```ts
import { consumeSseResponse } from "agent-chat-protocol";
await consumeSseResponse(await fetch("/chat", init), (ev) => render(ev));
```

or run the primitives yourself (`parseSseBuffer` for framing, `mapSseToChatEvent` for validation) if you manage the reader loop.

Wire notes: the SSE `event:` name is the union's `type`; the `data:` payload is the rest of the variant — except `controls`, whose spec **is** the payload (not wrapped in `{spec}`).

## Generative UI

The agent emits interactive widgets by ending a message with a fenced block. Both sides of that grammar live here so they can't drift:

**Emit side** — append the question prompt section to your system prompt (Claude `appendSystemPrompt`, Codex `developerInstructions`):

```ts
import { QUESTION_PROMPT, CONTROLS_BLOCK_NAME } from "agent-chat-protocol";
```

Controls emission guidance is **app-authored**: what the controls tune is an app concern (carve's is CSS), so each app writes its own controls prompt section, using `CONTROLS_BLOCK_NAME` as the fence and the core widget schema this package validates.

**Parse side** — the bridge does this for you; standalone:

```ts
import { parseQuestionBlock, parseControlsBlock } from "agent-chat-protocol";
```

Canonical fence names are `agent-question` / `agent-controls`; the legacy `carve-question` / `carve-controls` fences are accepted during migration but should not be taught to agents. Malformed blocks are left in the prose as plain text — a slightly raw message beats a dropped one. A valid controls block suppresses its surrounding prose entirely (the panel is the message).

The core controls schema (`ControlsSpec`) is `{ title?, controls }` — the widgets only — validated defensively (bounded counts and lengths, clamped slider values, duplicate-id rejection). `validateControls` returns the canonical core spec or `null`, ignoring unknown fields.

**App extensions** — an app can carry extra fields on the block (carve layers CSS style bindings and scopes) through three seams, all defaulting to the core validator:

- `parseControlsBlock(raw, validate)` — a custom validator lifts the extended spec; when it rejects, the block stays in the prose as plain text.
- `createChatEventBridge(emit, { controlsValidator })` — same, server side.
- `consumeSseResponse(res, onEvent, { mapEvent })` — client side; the default mapper canonicalizes controls to the core spec, dropping extension fields, which is exactly what a client that doesn't understand the extension should see.

## Server bridge

Turn the runner's callbacks into events, buffer them for reattach, and stream:

```ts
import { runClaude } from "agent-cli-runner";
import { createChatEventBridge, createTaskStore } from "agent-chat-protocol/server";
import { encodeChatEvent, isTerminalEvent } from "agent-chat-protocol";

const store = createTaskStore();

async function runTurn(turnId: string, prompt: string, sessionId?: string) {
  const task = store.create(turnId);
  const bridge = createChatEventBridge((ev) => store.push(task, ev), {
    ...(sessionId ? {} : { presetSessionId: crypto.randomUUID() }),
  });
  try {
    const result = await runClaude({
      prompt,
      cwd: process.cwd(),
      signal: task.abort.signal,
      ...(sessionId ? { resumeSessionId: sessionId } : {}),
      ...bridge.callbacks,
    });
    bridge.finish(result);
  } catch (err) {
    bridge.fail(err);
  } finally {
    store.complete(task);
  }
}

// Streaming a (re)attached client: replay then subscribe — push is
// synchronous, so done in one tick there is no gap.
function stream(task, write: (chunk: string) => void) {
  for (const ev of task.events) write(encodeChatEvent(ev));
  if (task.done) return;
  const unsub = store.subscribe(task, (ev) => {
    write(encodeChatEvent(ev));
    if (isTerminalEvent(ev)) unsub();
  });
}
```

`bridge.fail` maps the runner's failures onto the contract: `AbortError` → `aborted (user)`, `TimeoutError` → `aborted (timeout)`, anything else → `error`.

## Chat titles

`createChatTitleGenerator` provides one shared, opt-in policy for apps that use
the Claude Code and Codex CLI stack: Claude uses `haiku`, Codex uses
`gpt-5.6-luna`, and both use low effort in an isolated run. The helper owns the
prompt, bounded input, normalization, and heuristic fallback; the app injects
its runner so this package never starts a process or triggers billable work by
itself.

```ts
import { createChatTitleGenerator } from "agent-chat-protocol/server";

const generateTitle = createChatTitleGenerator({
  run: (request) => runAgent({
    ...request,
    cwd: temporaryDirectory,
    continueConversation: false,
  }),
});

const result = await generateTitle({
  provider: "codex",
  prompt: latestUserMessage,
  currentTitle,
  previousPrompts: previousUserMessages.slice(-2),
  attachmentNames: ["checkout.png"],
  signal,
});

if (result.source === "model") {
  persistTitle(result.title);
  emit({ type: "thread_title", title: result.title });
}
```

Apps can call the helper on every user turn. When `currentTitle` is supplied,
the prompt asks the model to return it exactly unless the main task has
materially changed; `previousPrompts` provides a small amount of topic context.
Generation failure, timeout, an empty response, or a non-zero exit returns the
current title (or the first-line/image-name fallback for a new chat) with
`source: "fallback"`. Apps should keep the persisted title in that case and
emit no title event. Cancellation is propagated to the caller.

## Design constraints

- **Types + functions, not a framework.** No view layer ships here; rendering is Layer 3, per app.
- **Zero runtime dependencies.** `agent-cli-runner` is a (type-only) peer of the server entry.
- **Provider-neutral wire contract.** Stream events carry no Claude- or Codex-specific shape. The optional server title helper deliberately centralizes the shared CLI model policy behind an injected runner.
- **Strict ESM**, built with tsdown; `dist/` committed for `github:` installs.

## Development

```sh
pnpm install
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm build       # tsdown → dist/
```
