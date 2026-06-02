# AI Chat UI/UX Improvement Plan

_Goal: make the in-app AI chat feel as fluid and friendly as Claude.ai / a self-hosted
Odysseus workspace — streaming, legible, low-friction — while staying inside this repo's
existing design-token system and the Hermes (ChatGPT-OAuth) backend._

Status: proposal. Author pass: 2026-06-02.

---

## 1. Executive summary

The chat works end-to-end (browser → `/api/ai/chat` → Hermes gateway → DB), but the
experience has one structural problem and a cluster of polish gaps:

- **The killer issue: no streaming.** `/api/ai/chat` calls the gateway with
  `stream: false` and the client shows a single "Working…" spinner. Real answers take
  **60–80s** (the agent runs DB tool calls). For a full minute the user sees a static
  spinner and cannot tell if it's alive, cannot cancel, and gets the whole answer at once.
  **The gateway already supports SSE streaming** (verified — it emits OpenAI
  `delta.content` chunks), so this is a wiring problem, not a backend limitation.
- **Two near-duplicate components** drifting apart: `AiChatPanel.tsx` (~435 lines) and
  `admin/AiChatTab.tsx` (~605 lines) re-implement the same send loop, autosize, health,
  and message rendering with subtle differences.
- **A costly health check:** `AiChatTab` pings liveness by POSTing a real `'ping'`
  message to `/api/ai/chat` **every 60s** (`AiChatTab.tsx:148`), which actually runs the
  agent and burns ChatGPT quota. `AiChatPanel` does it correctly via `/api/ai/chat-health`.
- **No message actions** (copy / regenerate / stop / edit), **no agent-step transparency**
  (you can't see "querying orders…"), **no code syntax highlighting**, and a **sharp,
  box-heavy visual language** that reads as "industrial dashboard," not "conversation."

This plan unifies the two surfaces behind one streaming-first hook, adds the Claude-style
affordances (streaming text, stop, copy, regenerate, tool-step disclosure, softened
message styling), and sequences the work P0→P3 so the highest-impact change (streaming)
ships first.

---

## 2. Current-state audit

### 2.1 Surfaces
| Surface | File | Used in | Notes |
|---|---|---|---|
| Floating/side panel | `src/components/ai/AiChatPanel.tsx` | dashboard pane | per-mount session via `/api/ai/session`; health via `/api/ai/chat-health` ✅ |
| Admin full tab | `src/components/admin/AiChatTab.tsx` | `/admin?section=ai_chat` | has session **history sidebar** + Bose prompts; health via real `ping` POST ❌ |

### 2.2 Render pipeline (shared, good foundation — keep)
- `AiAnswerCard.tsx` — structured answer card: title, confidence chip, metrics grid,
  breakdown table, sample records `<details>`, source chips, actions, follow-ups.
- `MarkdownRenderer.tsx` — `react-markdown` + `remark-gfm`; styled headings, lists,
  tables, inline/block code (plain dark block, **no highlighting**), links.
- `AiPromptChips.tsx` — suggestion buttons.

### 2.3 Backend contract
- `POST /api/ai/chat` → `{ reply, sessionId, mode, analysis }` (`AiChatRouteResponse`),
  `stream: false`, `AbortSignal.timeout(120_000)`.
- Modes: `local_ops` (deterministic, instant), `rag` (Bose manual), `hybrid`,
  `assistant` (Hermes). Structured `analysis` only on local_ops/hybrid/rag.
- Gateway: OpenAI-compatible, **SSE streaming confirmed working**.

### 2.4 Design tokens (the constraint)
`src/design-system/tokens/typography/presets.ts` is deliberately brutalist:
`sectionLabel = text-micro font-black uppercase tracking-[0.2em]`, square borders,
warm paper bg `#fbfbfa`. The plan **softens within this system** (introduce a chat-only
"comfortable" layer) rather than fighting or rebranding it.

---

## 3. Findings → concrete UX problems

1. **No streaming / no progress** — 60–80s static spinner. (`route.ts` stream:false; `AiChatPanel.tsx:374`, `AiChatTab.tsx:552`)
2. **No cancel/stop** — long request can't be aborted; no `AbortController` on the client.
3. **No message actions** — can't copy an answer, regenerate, or edit+resend a question.
4. **No agent transparency** — Hermes runs DB tool calls but the UI never shows
   "Querying `orders`…"; the most reassuring possible signal during a 60s wait is hidden.
5. **Duplicate components** — double maintenance, drift (timestamps, status labels,
   prompts, session handling all differ).
6. **Wasteful liveness ping** — `AiChatTab` health check invokes the agent every 60s.
7. **No syntax highlighting** — code blocks are unstyled dark boxes; no language label,
   no copy-code button.
8. **Auto-scroll fights the user** — `scrollIntoView({behavior:'smooth'})` on every
   update yanks the view down even when the user scrolled up to read.
9. **No streaming a11y** — no `aria-live`/`role="log"`; screen readers get nothing until
   the full answer lands.
10. **Sharp, boxy styling** — every element is a hard-bordered rectangle; no message
    grouping, avatars are outline boxes, density is high. Reads as a table, not a chat.
11. **Empty state is text-heavy** — two dense info panels; suggestions compete with prose.
12. **No keyboard model beyond Enter** — no ⌘K focus, ⌘↵ send, Esc to stop, ↑ to edit last.
13. **Session persistence gaps** — `AiChatPanel` makes a fresh session every mount (no
    resume on reload); history sidebar exists only in the admin tab.
14. **Mobile** — fixed `max-w-4xl`, push-sidebar without overlay, small tap targets.

---

## 4. What "Claude-like / Odysseus-like" means here

From Claude.ai and the Odysseus self-hosted workspace, the transferable patterns:

- **Streaming-first**: tokens appear as they're produced; a blinking caret; a **Stop**
  button replaces Send while generating.
- **Calm reading column**: single centered column, generous line-height, assistant text
  is full-width with **no bubble**; user turns are a light, distinct block.
- **Per-message hover actions**: Copy, Retry/Regenerate, (and for us) "Open source."
- **Tool/step transparency** (Odysseus agent runs): a collapsible "Hermes is working"
  timeline — "Querying orders… 2,356 rows… composing answer."
- **Great code**: syntax highlighting, language tag, copy-code button.
- **Polished composer**: rounded, auto-growing, slash/⌘K affordances, attach-free but
  with prompt suggestions inline.
- **Responsive/PWA**: works on a phone on the warehouse floor.

We adopt the *interaction* patterns, and translate the *visual* tone into this repo's
tokens (warm paper, strong labels) so it still looks like USAV, not a generic ChatGPT clone.

---

## 5. Target design principles

1. **Streaming is the baseline**, not a feature. Every answer streams.
2. **One component, one hook.** Panel and Tab are thin wrappers over `useAiChat` + `<ChatThread/>`.
3. **Always show life and give an exit.** Progress + Stop at all times during generation.
4. **Reading-optimized.** Wider line-height, message grouping, restrained borders.
5. **Reuse the structured card.** `AiAnswerCard` stays the hero for local_ops/rag/hybrid.
6. **Respect the tokens.** Soften (rounding, spacing) in a chat-scoped layer; don't rebrand.
7. **Accessible + mobile by default.** `aria-live`, focus order, 44px targets.

---

## 6. Architecture & component plan

### 6.1 Unify: `useAiChat` hook + `ChatThread` (P0)
Create `src/components/ai/useAiChat.ts` owning: `messages`, `input`, `status`
(`idle|streaming|error`), `sessionId`, `send()`, `stop()`, `regenerate()`,
`editAndResend()`, autosize, and scroll-anchoring. Both surfaces become:
- `AiChatPanel` = header + `<ChatThread variant="panel"/>` + `<Composer/>`.
- `AiChatTab` = sidebar + same `<ChatThread/>` + `<Composer/>`.
Delete the duplicated logic from both files. Net: ~600 lines removed.

New files:
- `src/components/ai/useAiChat.ts`
- `src/components/ai/ChatThread.tsx`
- `src/components/ai/ChatMessage.tsx` (user/assistant/error/streaming variants)
- `src/components/ai/Composer.tsx`
- `src/components/ai/AgentStepTimeline.tsx`
- `src/components/ai/CodeBlock.tsx`

### 6.2 Streaming SSE (P0 — highest impact)
**Backend:** add a streaming path to `/api/ai/chat` (or a sibling `POST /api/ai/chat/stream`)
that forwards the gateway with `stream: true` and re-emits SSE to the browser. Keep the
existing non-streaming branches for `local_ops`/`rag` (they're instant + structured —
return them as a single terminal SSE event). Shape the event stream as:
```
event: meta     data: {"mode":"assistant","sessionId":"…"}
event: step     data: {"label":"Querying orders","state":"running"}   // optional, see 6.4
event: delta    data: {"text":"23"}
event: delta    data: {"text":"56 orders…"}
event: analysis data: {…AiStructuredAnswer}                            // local_ops/hybrid/rag
event: done     data: {"finish":"stop"}
```
- Use Next.js Node runtime (already set) + `ReadableStream`.
- Strip `<think>…</think>` server-side **across chunk boundaries** (buffer a tail window).
- Preserve `persistChatMessage` on `done` (persist the final assembled text).
- Keep a hard server timeout but make it generous (gateway took ~78s; allow 180s) and
  send periodic `event: ping` keep-alives so proxies don't drop the connection.

**Client:** `useAiChat.send()` opens the stream via `fetch` + `getReader()`, appends
`delta` text to the in-flight assistant message, swaps in the structured `analysis` when
it arrives, and flips `status` to idle on `done`. A `Stop` button calls
`AbortController.abort()`.

### 6.3 Message actions (P1)
On hover/focus of each assistant message (and always on touch): **Copy** (clipboard of raw
markdown), **Regenerate** (re-send the preceding user turn; replaces the message),
**Good/Bad** feedback (optional, write to a `ai_chat_feedback` table for later tuning).
User turns get **Edit** (loads text back into composer, truncates thread to that point,
resends — Claude's "edit message" behavior).

### 6.4 Agent step transparency (P1 — big reassurance win)
During the 60–80s wait, show a compact, collapsible **AgentStepTimeline** instead of a
bare spinner: "Understanding question → Querying database → Composing answer," with a live
elapsed timer. Two implementation tiers:
- **Tier A (no backend change):** heuristic stepper driven by elapsed time + detected
  intents (we already compute `detectIntents`); good enough to feel alive.
- **Tier B (real):** have the gateway/agent emit `event: step` SSE frames for actual tool
  calls. Requires a small change in the Hermes side (`hermes-usav`) to surface tool spans
  to the API server. Plan Tier A now, Tier B as a follow-up.

### 6.5 Markdown + code (P1)
- Add `rehype-highlight` (or Shiki via `rehype-pretty-code`) to `MarkdownRenderer`.
- New `CodeBlock.tsx`: language label + **Copy code** button + horizontal scroll + wrap toggle.
- Tighten table styling for wide DB result tables (sticky header, zebra rows, max-height + scroll).
- Render assistant markdown **incrementally** during streaming (react-markdown re-parse on
  each delta is fine at these sizes; memoize finished blocks).

### 6.6 Composer redesign (P1)
- Rounded container, auto-grow to ~8 lines, paper bg, focus ring in brand color.
- Send→Stop morph while streaming. Disabled reasons surfaced as placeholder text.
- Keyboard: `⌘/Ctrl+Enter` send, `Enter` send / `Shift+Enter` newline (configurable),
  `Esc` stop, `↑` on empty input edits last user message, `⌘K` focuses composer from anywhere.
- Inline suggestion chips above the composer when input is empty (collapse after first turn).

### 6.7 Empty state (P2)
Replace the two dense panels with: a one-line greeting, 3–4 **example prompt cards**
(grouped: Ops / FBA / Repairs / Bose), and a small "What I can see" disclosure (collapsed).
Keep it scannable; let the conversation be the focus.

### 6.8 Session history (P2)
Promote the admin tab's sidebar into the shared component so the panel can use it too.
Add: rename, search, "pin," and persistent `sessionId` in `localStorage` so reload resumes.
(Backend already has `/api/ai/chat-sessions` + messages endpoints.)

### 6.9 Visual language — soften within tokens (P2)
- Assistant messages: borderless, full column width, `leading-7`, comfortable vertical rhythm,
  small bot glyph in the gutter; group consecutive same-role turns.
- User messages: light paper block, subtle left accent, not a hard rectangle.
- Introduce a chat-scoped radius (`rounded-lg`) and spacing scale; keep `sectionLabel`
  for the structured card headers so it still feels USAV.
- Motion via existing `framer-motion`: message fade/translate-in, caret blink, timeline
  step transitions, Stop-button morph. Keep it ≤150ms, respect `prefers-reduced-motion`.

### 6.10 Accessibility (P1, ongoing)
- Thread is `role="log" aria-live="polite" aria-relevant="additions text"`.
- Streaming message announces politely; Stop is reachable and labeled.
- Focus management: after send, focus stays in composer; after stop, return focus there.
- All actions have `aria-label`; contrast checked against paper bg.

### 6.11 Mobile / PWA (P2)
- Sidebar becomes an overlay drawer under `md`. Composer pinned with safe-area insets.
- 44px tap targets; suggestion chips horizontally scrollable.
- Verify it works installed (the app already targets warehouse-floor devices).

### 6.12 Performance / cleanup (P0–P1)
- **Fix the costly health check** (`AiChatTab.tsx:148`): switch to `/api/ai/chat-health`
  (GET, no agent run). Immediate quota + latency win. _(P0, 5-minute change.)_
- Scroll anchoring: only auto-scroll when the user is already near the bottom (track a
  `isPinned` ref); show a "↓ New messages" pill otherwise.
- Virtualize the thread only if sessions grow large (defer; not needed yet).

---

## 7. Phased roadmap

| Phase | Theme | Items | Impact | Est. |
|---|---|---|---|---|
| **P0** | Make it feel alive | 6.1 unify + hook, 6.2 streaming (route+client), 6.12 fix health ping, basic Stop | 🔴 Highest | 2–3 d |
| **P1** | Claude-grade interaction | 6.3 actions, 6.4 step timeline (Tier A), 6.5 code+markdown, 6.6 composer, 6.10 a11y | 🟠 High | 3–4 d |
| **P2** | Comfort & continuity | 6.7 empty state, 6.8 session sidebar+resume, 6.9 visual softening, 6.11 mobile | 🟡 Med | 3–4 d |
| **P3** | Depth | 6.4 Tier B real tool spans, feedback capture, model/mode selector, theme polish | 🟢 Nice | 2–3 d |

**Quick wins (do first, <1 day total):** fix the health-check ping (6.12); add Stop +
`AbortController`; switch the spinner to an elapsed-time + step label; copy-answer button.

---

## 8. Concrete change list

**New**
- `src/components/ai/useAiChat.ts`, `ChatThread.tsx`, `ChatMessage.tsx`, `Composer.tsx`,
  `AgentStepTimeline.tsx`, `CodeBlock.tsx`
- `src/app/api/ai/chat/stream/route.ts` (or stream branch in existing route)

**Edit**
- `src/components/ai/AiChatPanel.tsx` → thin wrapper
- `src/components/admin/AiChatTab.tsx` → thin wrapper (fix health check)
- `src/components/ai/MarkdownRenderer.tsx` → `rehype-highlight` + `CodeBlock`
- `src/components/ai/AiAnswerCard.tsx` → accept streaming/partial state; add copy
- `src/lib/ai/types.ts` → SSE event types; optional `step`/feedback types

**Deps**
- add `rehype-highlight` (or `rehype-pretty-code` + `shiki`). `framer-motion`,
  `react-markdown`, `remark-gfm` already present.

**Optional backend (P3)**
- `hermes-usav` API server: emit `event: step` tool spans.
- Migration: `ai_chat_feedback` table.

---

## 9. Risks & decisions to confirm

- **Visual direction:** soften-within-tokens (recommended) vs. a bolder Claude-style
  rebrand of the chat surface. Affects 6.9 scope.
- **Streaming route shape:** extend `/api/ai/chat` with a stream branch vs. a new
  `/stream` route (cleaner, but two endpoints). Recommend the branch + `Accept: text/event-stream`.
- **Step transparency tier:** ship Tier A heuristic now; commit to Tier B only if the
  `hermes-usav` change is wanted.
- **Enter-to-send vs ⌘Enter:** warehouse users may prefer Enter=send; make it a setting.

---

## 10. Definition of done (P0)

A user asks a question and: tokens stream within ~1–2s of the agent starting; a Stop
button is available the whole time; an elapsed timer + step label shows progress; the
final structured card (when applicable) renders; the answer can be copied; and both the
panel and the admin tab use the same code path. Health checks no longer invoke the agent.
