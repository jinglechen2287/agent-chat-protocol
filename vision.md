# agent-chat-protocol — Vision

> A framework-agnostic contract for rendering an agent turn as a live, interactive chat — the streaming event grammar, the generative-UI vocabulary, and the rendering rules that make them mean something.

## One-liner

`agent-cli-runner` answers *"how do I drive an agent CLI and get callbacks?"*
`agent-chat-protocol` answers *"how is an agent turn represented as streamable events, and how is a client expected to render and respond to them?"*

It is the shared layer that lets multiple frontends — carve's SolidJS Studio, agent-remote's React app and Telegram bot, and whatever comes next — deliver the **same chat UX** (streaming text, visible tool calls, real markdown, interactive question/controls cards, reconnect-to-in-flight) without each app re-deriving the protocol from scratch.

## Why this exists

Two apps in this workspace already talk to the same agent CLIs through `agent-cli-runner`:

- **carve** — has a rich chat UX: SSE streaming end to end, expandable tool-call pills with per-tool details, `marked`+`dompurify` markdown, and two *generative UI* widgets (`carve-question` option chips, `carve-controls` live sliders/color-pickers with agent-selected scopes). Since the SolidJS migration the chat is no longer a vanilla-DOM monolith — it's a SolidJS component tree (`src/studio/`) on a dedicated `/@carve/studio` page that iframes the target site — but the protocol knowledge is still carve-private, spread across its studio runtime, `overlay/transport.ts`, and server middleware.
- **agent-remote** — drive local agents from your phone. It is a Telegram bot first (grammy/Bun, `src/bot.ts`) with a React web app in `web/`; both frontends consume the same server path. Today its chat is **turn-based and lossy**: `src/claude.ts` / `src/codex.ts` never subscribe to `agent-cli-runner`'s streaming callbacks at all — they just `await` the final `RunResult.text`, store it as flat text, and return it over a single blocking HTTP call. Users see a frozen timer, then a wall of near-plain text. No streaming, no tool visibility, no rich markdown, no interactive widgets.

The valuable, genuinely-shared asset in carve is **not the pixels** — it's the *contract and the pipeline*: the event union, the SSE codec, the generative-UI grammar, and the rules for how each event renders. That is what agent-remote is missing, and that is exactly what this package extracts.

Carve's *rendering code* is deliberately **not** in scope to share — it's a SolidJS component tree, while agent-remote is React + Tailwind + shadcn (plus a Telegram bot). You cannot share widgets across those boundaries. You *can* share the contract they all implement — and carve's migration makes the Layer-3 shape concrete: its `MessageList` / `ToolMessage` / `QuestionMessage` / `ControlsMessage` components are exactly the set agent-remote needs to build in React. Same contract, two component trees.

## Where it sits — the three layers

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3 — Rendering (per-app, per-framework)                 │
│   carve: SolidJS studio  │  agent-remote: React + Telegram    │
│   both implement the same rendering contract ↓                │
├─────────────────────────────────────────────────────────────┤
│ Layer 2 — agent-chat-protocol  ◀── this package               │
│   • ChatStreamEvent union (the wire contract)                 │
│   • SSE encode/decode codec (server ⇄ client)                 │
│   • generative-UI grammar (question / controls parse + emit)  │
│   • runner-callbacks → events bridge (server side)            │
│   • the normative RENDERING CONTRACT (docs + TSDoc)           │
├─────────────────────────────────────────────────────────────┤
│ Layer 1 — agent-cli-runner (existing)                         │
│   spawn the CLI subprocess, stream callbacks                  │
└─────────────────────────────────────────────────────────────┘
```

**Dependency direction is one-way:** `agent-chat-protocol` depends on `agent-cli-runner`, never the reverse. The runner has no idea what SSE or a "controls card" is. This package is a *separate* package precisely because it is a different layer with different consumers (browser **and** server, vs. server-only), different churn (fast-moving UI contract vs. stable subprocess runtime), and its own release rhythm.

## What a user gets once a frontend adopts this

The package is plumbing — users never see it. They see what it unlocks, once a frontend renders against the contract:

1. **Live streaming** — text appears as the agent works, instead of a frozen timer then a blob.
2. **A visible tool-call trace** — "Read `api.ts`", "Bash `bun test`", "Edit `Chat.tsx`" inline, because `tool_use` events are preserved instead of discarded.
3. **Real markdown** — full GFM (headings, lists, links, tables, highlighted code).
4. **Generative UIs** — the agent can render interactive widgets:
   - **Question cards** — a clarifying question with tappable options (great on mobile).
   - **Controls cards** — sliders / color pickers / selects with live preview and Apply.
5. **Reconnect to an in-flight turn** — lock the phone, come back, the turn is still streaming — rebuilt from the buffered event stream. This matters far more for a *remote* client than it ever did for carve.

## Scope

### In scope (the contract and its plumbing)

- **`ChatStreamEvent` union** — the canonical event vocabulary, seeded from the nine events carve already emits on the wire: `session_started`, `assistant_text`, `tool_use`, `question`, `controls`, `stderr`, `done`, `aborted`, `error` (names illustrative; final set TBD). This is the wire contract between server and client. `tool_use` now carries `{ name, summary?, details? }`, where `details` is a curated list of `{ label, value }` pairs (carve's `tool-details.ts`) — that shape is part of the contract. *Decided:* `stderr` stays in the union as an optional diagnostic event — clients MAY ignore it (carve's client does today), but it stays on the wire for remote debuggability. `aborted` should carry a reason distinguishing a user cancel (`AbortError`) from a wall-clock timeout (`TimeoutError`) — the runner raises them as distinct failures and a client should render them differently.
- **SSE codec** — encode events on the server, decode/normalize on the client (carve's `consumeSse` / `parseSseBuffer` / `mapSseToChatEvent`, generalized). Transport-shaped but transport-agnostic in spirit — SSE first, leave room for others.
- **Generative-UI grammar** — the parse-side (extract `question` / `controls` blocks from assistant text) *and* the emit-side spec (the system-prompt append that teaches an agent when and how to emit them). Both sides, one source of truth, so they can't drift. *Decided:* the canonical fenced-block names are `agent-question` / `agent-controls` — a shared protocol shouldn't carry one consumer's brand in its wire grammar. The shared parser also accepts the legacy `carve-question` / `carve-controls` names during migration (no flag day for carve; legacy support dropped later).
- **Runner→events bridge** — the server-side glue that turns `agent-cli-runner`'s **four** callbacks — `onSessionId`, `onAssistantText`, `onToolUse`, `onStderr` — into `ChatStreamEvent`s (carve's `runAgentTask`, generalized). Includes the tool-detail projection (carve's `src/server/tool-details.ts`): the curated mapping from raw `ToolUseInfo` input to displayable `{ label, value }` pairs per tool. It's framework-agnostic server logic every consumer wants identically — a natural fit here rather than per-app.
- **The rendering contract** — normative, framework-agnostic docs describing, per event kind: semantics · required render · interaction · loading/error states · the round-trip a `question`/`controls` interaction feeds back as the next turn. Delivered as README spec **and** TSDoc on the event types themselves (so it reaches devs in editor tooltips and agents in-context, at the point of use).

### Explicitly out of scope

- **Visual / brand design** — colors, spacing, animation, component libraries. The contract says *"a `question` MUST render its options as selectable choices and send the chosen option's label back verbatim as the next user turn"*, never *"an 8px-gap pill row."* Any frontend — vanilla DOM or React — must be able to satisfy it.
- **Rendering code / components** — no React components, no DOM widgets ship here. Those are Layer 3, per-app.
- **The CLI subprocess runtime** — that's `agent-cli-runner`.
- **Persistence** — how an app stores transcripts (agent-remote's SQLite, carve's localStorage) is the app's concern; this package defines the events, not the database.
- **Interactive permission/approval prompts** — a deliberate non-goal, stated so it isn't a silent assumption: today every consumer runs with approvals fully bypassed (codex via `dangerouslyBypassApprovalsAndSandbox`, Claude non-interactively), so the vocabulary has no permission event. If interactive approvals ever arrive, that's a new event kind and a contract revision — reserved, not accidentally precluded.

## Two audiences of the contract

The contract has two sides, and keeping them in sync is a core reason this package exists:

1. **The agent that *emits*** `question` / `controls` — needs the block grammar and guidance on *when* to use each. (Today half-encoded in carve's `SYSTEM_PROMPT_APPEND`.)
2. **The client that *renders*** events — needs render + interaction semantics and the response round-trip.

Both specs live here, together, as one source of truth.

## Design principles (modeled on agent-cli-runner)

- **Tiny public barrel.** One `src/index.ts` re-exporting a handful of types, functions, and error classes; internals stay private.
- **Types + functions, not a framework.** Expose the contract and pure codecs/parsers. No view layer, no framework assumptions.
- **Framework-agnostic and dual-environment.** Client-safe code (event types, SSE decode) must not drag in `node:child_process` or any server-only dependency. One package, two entry points: the root export is client-safe; server-only glue (the runner bridge) lives behind an `agent-chat-protocol/server` subpath export, so browser bundles stay clean without splitting into two packages.
- **Provider-neutral.** Both apps already branch claude/codex behind one event stream (carve's middleware, agent-remote's `provider.ts`); the contract must never leak a provider-specific shape. This neutrality is the actual constraint that keeps multiple runners behind one event vocabulary.
- **Zero / minimal runtime deps.** Match the runner's discipline. Markdown *rendering* is a Layer-3 concern; if a tokenizer is ever shared, weigh it carefully.
- **Dependency-injection seams** for testability (as the runner does with `spawnFn`).
- **Strict ESM, bundled (`tsup`/`tsdown`) → committed `dist/` + `.d.ts`, installed via `github:` spec.** The committed-dist discipline follows `agent-cli-runner` (carve itself has since moved to tsdown with a gitignored `dist/`, but a `github:`-installed package needs the build artifact in the repo). Both pnpm (carve) and Bun (agent-remote) consumers get a build-free install, pinned per-consumer by lockfile commit — no npm publish required.
- **The docs are a first-class deliverable**, not an afterthought. A contract nobody can read is just a bag of types.

## Consumers

- **carve** — already implements this UX; adopting the package means conforming its Studio components + server to the shared contract (largely a refactor + a source-of-truth move for the generative-UI grammar and `tool-details.ts`, plus migrating the fenced-block names off the `carve-` prefix). Its SolidJS components become the reference Layer-3 implementation.
- **agent-remote (web)** — the primary motivating consumer. Adopting means real work *beyond* this package (see below), but this package is the prerequisite that makes carve-grade UX buildable without re-deriving the protocol.
- **agent-remote (Telegram bot)** — a third renderer, and a valuable one precisely because it isn't a browser: a bot that renders `tool_use` events as message edits and `question` cards as inline keyboards is the strongest possible stress test of "any frontend can satisfy the contract." Not a launch requirement, but the contract should be written so nothing about it assumes a DOM.

## What this package does *not* do for agent-remote (prerequisite app work)

This package is necessary but not sufficient. The user-visible payoff lands only when agent-remote also:

- **Wires up the streaming callbacks** in `src/claude.ts` / `src/codex.ts` — today they don't subscribe to `onSessionId` / `onAssistantText` / `onToolUse` / `onStderr` at all, only `await`ing the final `RunResult.text`.
- **Adds a streaming transport** (SSE) to `src/api.ts` — today `POST /threads/:id/messages` blocks until the turn ends.
- **Extends the SQLite schema** (`thread-store.ts`) beyond `{ role, text }` to persist structured content blocks and tool events, so a reloaded thread reconstructs the trace.
- **Builds Layer-3 React components** — MessageList, ToolCallPill, Markdown, QuestionCard, ControlsCard — rendering against the contract in its existing shadcn/Tailwind system.

## Naming & packaging (proposed, to confirm)

- **Package name:** `agent-chat-protocol` (mirrors `agent-cli-runner`'s single-purpose naming).
- **Distribution:** same model as `agent-cli-runner` — `github:` install, committed `dist/`, per-consumer lockfile pin.
- **Repo layout:** standalone repo is simplest and matches the sibling. If two git installs become annoying, an alternative is a small monorepo publishing `agent-cli-runner` + `agent-chat-protocol` as two entry points — independent versioning, one repo. Decide before first consumer wires it in.
- **Rollout order (decided):** extract the package from carve's working code (events, transport codec, parsers, tool-details, bridge), conform carve to it as the first consumer — validating the contract against a proven implementation — then start agent-remote's adoption.

## Open questions — resolution status

Resolved and shipped in the package (see README + typed contract for the normative text):

- **`ChatStreamEvent` shape** — nine variants; `tool_use` carries `{ name, summary?, details? }`; `aborted` carries a `user`/`timeout` reason; events arrive in stream order and exactly one terminal event ends a turn.
- **Emit-side format** — fenced text blocks, renamed to `agent-question` / `agent-controls`; the shared parser accepts legacy `carve-*` during migration.
- **Controls grammar** — *revised in v0.2:* the core contract is the widgets only (`{ title?, controls }` — slider/color/select + Apply round-trip). The CSS machinery (style-binding templates, property allowlist, scopes, style substitution) is carve-internal, layered on via validator seams (`parseControlsBlock`'s validator param, the bridge's `controlsValidator`, `consumeSseResponse`'s `mapEvent`). CSS custom properties are not supported anywhere — an earlier carve addition, deliberately removed.
- **Reconnect/replay** — carve's task-store generalized into `createTaskStore`; replay-then-subscribe is a documented contract and replayed events render identically to live ones.
- **Protocol versioning** — `PROTOCOL_VERSION` is carried on `session_started`; clients tolerate its absence on legacy streams.

Still open (app-level, to settle during adoption):

- **Session resume/continuation semantics** — `session_started` is documented as first-turn-only (a resuming client already holds its id), but richer continuation modeling (agent-remote's per-thread `conversationId` + `continueConversation`) remains the app's concern for now.

## The bar for "done" on the vision

A new developer or agent can read this package's docs and its typed event contract, and build a *correct* chat frontend — one that streams, shows tool calls, renders markdown, and drives the question/controls widgets with the right round-trip — **without ever reading carve's source to guess the intent.** That is the whole point: turn tribal knowledge scattered across carve's studio runtime, transport, and server middleware into a contract anyone can adopt.
