# Universal Surfaces & Polymorphic Linkages — AI-First Plan (feed_memberships + lean companions)

> **Status:** PHASES 0–5 COMPLETE (2026-07-03/04). Only the plan's "Later" section (Redis hot paths,
> anonymized cross-org benchmark aggregation, generative onboarding, Jetson classifiers) remains — out
> of scope by design. Migrations `2026-07-03j..s` APPLIED to the live DB (411 on record, 0 pending).
> Build report + honest status: `docs/todo/universal-feed-ai-first-RUN-REPORT.md`.
> Executable SoT for the kind catalog / trust classes: `src/lib/surfaces/registry.ts` (+ §10 below).
>
> **Phase 5 COMPLETE.** nightly signal→insight_links rollup cron (+ migration `2026-07-03s` widening
> the source CHECK to `org_rollup`); mutation accept/reject stats; BOTH history pages — the `/signals`
> Monitor timeline (`?mode=timeline`) AND the Workbench master-detail (`?mode=browse`, `?signalId=`);
> template-first onboarding (`applyTemplateToOrg` + `isDefault` Drizzle fix); and **MCP exposure of the
> read-tool registry** (`POST /api/mcp`, JSON-RPC 2.0, reuses `listAssistantTools`/`runAssistantTool`).
> **Phase 4 COMPLETE:** the reversible per-staff rail dismiss (replaces a destructive shared delete) +
> durable exclusion read-filter; and the **feed_memberships projection** — a stable carton-grain
> `receiving_triage` projection (`src/lib/receiving/feed-membership-projection.ts` +
> `/api/cron/feed-membership-projection`, every 10 min) that mirrors the live Unfound/Prioritize queue
> into `feed_memberships` so `getFeedState` returns real data. Backfilled live (67 rows: 53 active +
> 14 needs_match). Other feed_keys (receiving_unbox, testing_queue, …) are the same pattern over their
> own source tables — separate SoT mappings, follow-up.
>
> `ANTHROPIC_API_KEY` must still be added to `.env` before the assistant route is live (it 503s
> cleanly without it). The new nightly cron begins running once deployed (it's in `vercel.json`).
>
> **The reframe (v2, locked 2026-07-03 interview #2):** the platform is **AI-first, English-first**.
> The user never needs to learn the Studio mapping system. Talking to the AI is how the operation is
> inspected, explained, edited, and extended — the Studio canvas becomes a live *preview the AI drives*
> (think Google Stitch: describe → the canvas updates), not an editor the user must master. This
> inverts the v1 plan's Studio-centric interaction model; the table family below is unchanged, but the
> build order, the interaction architecture, and the Studio page itself are re-specified around AI.
>
> **Scope:** lean, additive, tenant-first polymorphic linkage tables (`feed_memberships`,
> `staff_rail_exclusions`, `entity_signals`, `node_surfaces`, `insight_links`, `agent_mutations` +
> `agent_mutation_affects`) powering: the AI's read substrate ("why" signals + context tools), a
> global English assistant on every page, an atomic AI write path, operator rails with per-staff
> dismiss, domain-linked history pages, and an AI-first Studio refactor.
>
> **Relationship to the other two plans:** complementary; same contract as `photo_entity_links`,
> `part_links`, receiving_line_facts, ops_events, item_workflow_state. Membership/signal rows repoint
> cleanly if the receiving spine splits later. `.claude/rules/polymorphic-tables.md` applies
> point-for-point.

---

## -2. AI-First Synthesis (interview #2 — 2026-07-03, supersedes conflicting v1 framing)

All locked via a second iterative interview after the v1 Q&A. Where v1 said "Studio chat is the
primary interaction surface," **this section wins.**

### Locked decisions

| Decision | Answer |
|---|---|
| **First slice** | **AI read substrate first**: `entity_signals` + the kind catalog + a typed org-scoped **read-tool registry** over ops_events / item_workflow_state / signals. The AI cannot explain "why" or propose good edits until it can read the business. Rails and mutations stack on this. |
| **AI surface** | **Global assistant everywhere** — one app-shell chat dock on every route (not per-page chats, not Studio-only). Studio is an optional visualization the AI deep-links into, never a prerequisite. |
| **AI context shape** | **Tool registry**, not a monolithic context-gather endpoint and not RAG-as-backbone. Small, typed, org-scoped read tools (`get_signals_by_node`, `get_unit_journey`, `get_feed_state`, `get_top_reasons`, `get_benchmarks`, …) the model composes per question. Additive like the kind registries: new capability = new tool, no migration. RAG over events/signals is a possible layer-2, not the spine. |
| **AI runtime** | **Claude API + in-repo server agent loop** first (persisting to existing `ai_chat_sessions`/`ai_chat_messages`), org-scoped per request. **MCP exposure of the same tool registry is a later power-user add-on** (external agents drive the same tools). Local Ollama not used for the propose-mutation loop (tool-use exactness matters). |
| **Studio ↔ AI linkage** | **Skill + tool family, NOT a custom-trained model.** The graph is structured data; a frontier model with typed tools + a canvas-control tool namespace handles it. Custom training bakes today's vocabulary into weights and goes stale as tenants add kinds; a skill reads the live registry at runtime. Fine-tuning (Jetson pipeline) is reserved for later narrow classification (e.g. free-text buyer notes → reason_code), never orchestration/navigation. |
| **Trust model (day one)** | **View-layer only auto-apply**: exclusions, feed membership state, signal inserts, node_surfaces config apply without review. Anything touching masters (staff creation, graph edges, status transitions) is review-gated. Widen the trusted list per mutation_kind as accepted/rejected stats accumulate. Per-tenant trust config is a later upgrade. |
| **Signal emitters (day one)** | **All four**: (1) returns/warranty reasons (incl. linkReturnedSerial context), (2) receiving exceptions + triage (unfound, carrier mismatch, pairing failures), (3) tech test-fail reasons (reason_codes already governed — cheapest), (4) buyer notes from order sync — via the **mirror-derivation standard** (§2.3): signals project from the local mirror, never emit inline in a connector; `source_ref` idempotency; eBay first, Amazon behind RDT as fast-follow. |
| **Rails timing** | **After the AI substrate ships** (strictly sequenced; AI-first over operator-throughput-first). Tables are still authored up front. |
| **Learning loop (phase 1)** | **Store + aggregate**: persist all chats/mutations/outcomes; nightly job aggregates signals into `insight_links` (top reasons by node, trends); AI reads its own history via tools; accepted/rejected mutation stats inform the trust list. No training infra yet. |
| **Studio edit contract** | **AI edits a live draft** — every conversational edit applies instantly to a draft version (canvas reacts live, Stitch-style preview). **Publish stays the human gate** (diagnostics + step-up auth). Undo = revert mutation on the draft. |
| **Manual editing UI fate** | **Demoted to inspector-only.** Canvas + inspector remain for viewing and micro-tweaks (rename, single config field); all structural editing (add/remove/rewire nodes, rules, surfaces) goes through chat. Read on canvas, write in English. |
| **Conversational scope** | **Everything**: graph structure (nodes/edges/ports/routing/config), staffing + stations (real `staff`/`staff_roles`/`staff_stations` rows), surfaces + rails (feed_keys, node_surfaces), vocabularies + settings (reason_codes, labels, settings-registry entries). |
| **Page taxonomy** | Ordinary pages = **skill + context injection** (staff/tenant Q&A in place). `/operations` = staff + KPI + **industry-standard comparison** (Monitor). `/studio` = **process-flow display** the AI drives. The assistant is the same one everywhere; only its registered skill/context differs. |
| **Draft testing** | **AI-narrated simulate + iterate loop**: reuse the existing Simulate panel (pure client dry-run, zero engine writes); AI runs fake/sample units through the edited draft, narrates what changed, flags diagnostics, and the user iterates conversationally ("what else would improve this?") before publish. |
| **Dock layout** | **Merge into one right dock.** On /studio the assistant dock absorbs StudioInspector: focused-node detail renders beneath the chat (the AI *is* the inspector). One right rail everywhere; no double-aside squeeze. |
| **Benchmarks** | **Seeded `insight_links` in phase 1** for the used-electronics-reseller vertical (test-fail %, return %, receive→list days) so /operations and the AI can say "you vs typical" from day one. Anonymized cross-org aggregates wait for multiple tenants. |
| **Onboarding** | **Templates first, AI refines**: new tenant picks a seeded vertical template (reseller-flow); the AI conversation customizes it afterward. Full generative "describe your business → whole graph" onboarding is a later flagship, after the edit loop is proven on USAV. |
| **Studio refactor timing** | **Rides the write path** (Phase 3): the moment agent_mutations can edit a draft, Studio flips AI-first (dock merged, manual editing demoted, canvas-control tools). Not a separate project. |

### The app-shell assistant (the "AI wrapper around every page")

The wrapper the whole experience hangs on:

1. **`AssistantProvider` in the root layout** hosting a persistent right-side dock (portal, named
   z-token, ~w-96, collapsible) on every route — chat on top; below it the **AI-edits tray**: the
   live draft's `agent_mutations` (applied/pending), each with check / test / revert affordances,
   updating over Ably.
2. **Context injection is a registry hook, not prop-drilling.** Pages/regions call
   `useAssistantContext({ page, station, selection, mode })` — same last-registered-wins pattern as
   `useRegisterScanTarget`. Per-page **skills are prompt fragments registered in the same registry**
   (staff Q&A skill on station pages, KPI/benchmark skill on /operations, flow-display skill on
   /studio).
3. **Navigation is a tool, and URL-as-state is the payoff.** Every surface is already
   URL-addressable (`/studio?v=&focus=&z=&lens=`, `?skuId=`, `?mode=`), so "take the user to draft
   testing" = a client-executed `navigate(path, params)` tool doing `router.push`. Add
   `highlight(ref)`, `focus_node(id)`, `set_lens(lens)` and the AI can walk a user through anything.
   No new state system — the house URL rules already built the rails.
4. **Tool split:** server tools (read registry, mutations) execute in the server agent loop; UI
   tools (navigate/highlight/zoom/lens) stream to the client as tool calls the provider executes and
   acknowledges (standard client-tool pattern).
5. **The canonical flow:** user asks in English → AI gathers via read tools → (optionally) proposes
   → mutation applies to draft server-side → Ably → `navigate('/studio?v=<draft>&focus=…')` → dock
   shows the edit trail → AI-narrated simulate on fake data → user iterates conversationally →
   human publishes (step-up + diagnostics gate).

---

## -1. v1 Synthesis (interview #1 — retained; still binding where not superseded above)

**Q1 — AI staff creation:** always **real rows** in `staff` + `staff_roles` + `staff_stations`.

**Q2 — Benchmarks:** both seeded templates **and** (later) anonymized cross-org aggregates, via
lean `insight_links`.

**Q3 — AI writes:** via `agent_mutations` reviewed/applied **atomically with extra audit**; lean
`agent_mutation_affects` junction; trusted auto-apply paths (now pinned to view-layer only, see
§-2); small/simple/exact-meaningful updates.

**Q4 — "Why" data:** structured polymorphic `entity_signals` (queryable "top reasons by node",
tsvector full-text) + emit to ops_events.

**Q5 — Rail scope & UX:** default = show all (shared `feed_memberships`); per-staff per-station
**dismiss** (insert into `staff_rail_exclusions`, like "dismiss as done") for personal focus;
shared awareness + individual throughput; multi-membership supported.

**Q6 — Mutation junction:** lean `agent_mutation_affects` with selective links; jsonb summary on
the proposal for context.

**Q7 — Caching:** PG-first (indexes + denorm). Comprehensive Redis plan deferred.

**Q8 — Realtime:** Ably on AI applies and sidebar/personal view changes.

**Q9 — Master endgoal:** superseded by §-2 — the assistant is global and English-first; the canvas
is the preview the AI drives (zoom/pan/highlight are tools), not the interaction home.

**Q10 — History pages:** NOT `feed_memberships`. Domain-based linkage to master tables (e.g.
receiving history = `receiving`/`receiving_lines` spine + `ops_events` + `entity_signals`),
date/time filterable, full-text over notes/reasons, both Monitor (timeline) and Workbench
(list + inspector) on different pages.

**Q11 — Naming:** clear descriptive table names; stable `kind`/`surface_key`/`signal_kind`/
`linkage_type` strings + a lightweight catalog/registry for AI + code; canonical refs in payloads
(e.g. `feed_memberships:feed_key:foo:entity:123`).

**Q12 — Future-proofing:** tenant-first; additive lean linkage tables; AI extends kinds/rows/
configs (registries + facts pattern) with minimal/no core migrations; store `agent_mutations` +
linked chats for improvement/training.

**Locked invariants:** SoT = `item_workflow_state` + `ops_events` (taps on `applyTransition` +
domain chokepoints) + guarded master tables — everything here is projection. Ultra-low-latency
sidebars via denorm + indexes (Redis later). All new tables obey
`.claude/rules/polymorphic-tables.md`. Realtime + audit on every meaningful change. History is
domain-linked, never polluted into active rails.

---

## 0. TL;DR

Build the **AI's read substrate first** (`entity_signals` wired from four emitters + a typed
read-tool registry + kind catalog), then a **global English assistant** on every page (server agent
loop on the Claude API over that registry, persisted to ai_chat_sessions), then the **AI write
path** (`agent_mutations` + atomic apply, view-layer auto-apply only) — at which point **Studio
flips AI-first** (Stitch-style: talk → draft updates live → AI-narrated simulate → human publish;
manual editing demoted to inspector micro-tweaks; assistant dock absorbs the inspector). Operator
rails (`feed_memberships` + `staff_rail_exclusions`) cut over **after** the AI substrate. Learning
= store everything + nightly aggregation into seeded-first `insight_links`. History stays
domain-linked to master spines. All tables lean, additive, tenant-from-birth, per the polymorphic
contract.

---

## 1. Decisions locked in (merged v1 + v2)

| Question | Decision |
|---|---|
| Interaction model | **AI-first, English-first, everywhere.** Global assistant dock; user never learns the mapping system; Studio = live preview the AI drives. |
| Feed / rail scope & UX | Universal first-class rails; shared defaults in `feed_memberships`; per-staff per-station dismiss in `staff_rail_exclusions` (default show-all); multi-membership. |
| Dismiss semantics | Non-destructive view unlink only; never touches source records or shared memberships. |
| Naming & refs | Descriptive table names; stable kind strings + lightweight catalog; canonical refs in data/events/mutations/endpoints. |
| Build order | Read substrate → assistant → write path (+ AI-first Studio) → rails → learning/aggregation. Tables authored up front in one migration wave. |
| Display data | Denormalized onto membership/signal rows for sidebar speed. |
| Studio | **Read-only live canvas + AI-driven editing of a live draft**; publish = human gate (step-up + diagnostics); manual structural editing removed from UI (inspector micro-tweaks only); assistant dock absorbs inspector. |
| History | Separate from active rails; domain-linked to master tables + events/signals; date/time + full-text; Monitor and Workbench variants on different pages. |
| AI write path | `agent_mutations` (linked to ai_chat_sessions) + `agent_mutation_affects`; atomic guarded apply; **auto-apply = view-layer kinds only day one**; extra audit + ops_event + Ably on every apply. |
| "Why" signals | `entity_signals` primary (structured, tsvector, per-node aggregates) + ops_events emission; four emitters wired day one. |
| Benchmarks | Seeded `insight_links` phase 1 (reseller vertical); anonymized aggregates when multi-tenant. |
| Single SoT | `item_workflow_state` + `ops_events` + guarded masters; rails/signals/surfaces are projections. |
| Caching | PG-first; Redis deferred. |
| Realtime | Ably on AI applies + sidebar/personal view changes + draft/canvas reactions. |
| AI runtime | Claude API in-repo agent loop; MCP exposure later for power users; skill+tools for Studio (no custom model); Jetson fine-tuning reserved for later narrow classification. |
| Onboarding | Templates first (reseller-flow seeds), AI refines conversationally; generative onboarding later. |
| Entity + surface vocabulary (day one) | Receiving carton/line, FBA, repair/warranty, orders + station-aware feed_keys/surfaces; AI + assistant extend per tenant. |

---

## 2. The lean linkage table family (tenant-first, additive)

Unchanged from v1. A small set of **lean, additive polymorphic linkage tables** (not one god table,
not per-feed_key splits). All obey `.claude/rules/polymorphic-tables.md`: org-led indexes/uniques,
named CHECK discriminators (or registry-validated kinds), BIGINT ids, tenant-from-birth via
`enforce_tenant_isolation()`, parent integrity via triggers/FKs, modeled in Drizzle same PR.

### 2.1 `feed_memberships` (shared/global defaults — the active selection working set)
```sql
CREATE TABLE feed_memberships (
  id                     BIGSERIAL PRIMARY KEY,
  organization_id        UUID NOT NULL,
  feed_key               TEXT NOT NULL,          -- e.g. 'receiving_triage', 'fba_outbound'
  entity_type            TEXT NOT NULL,
  entity_id              BIGINT NOT NULL,

  -- Studio/graph linkage (denorm for efficiency; SoT is item_workflow_state + node_surfaces)
  workflow_definition_id INTEGER,
  node_id                TEXT,

  state                  TEXT NOT NULL DEFAULT 'active',
  priority_tier          SMALLINT,
  occurred_at            TIMESTAMPTZ NOT NULL,
  title                  TEXT NOT NULL,
  subtitle               TEXT,
  tone                   TEXT NOT NULL DEFAULT 'default',
  meta                   JSONB,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- org-led unique + hot indexes; enforce_tenant_isolation('feed_memberships');
-- delete triggers on master parents
```

### 2.2 `staff_rail_exclusions` (per-staff per-station personal dismiss layer)
```sql
CREATE TABLE staff_rail_exclusions (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,
  staff_id        INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  station         VARCHAR(20) NOT NULL,
  feed_key        TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       BIGINT NOT NULL,
  excluded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- org + staff + station + feed_key + entity unique; enforce + indexes for
-- fast "base minus my exclusions" per staff/station
```

### 2.3 `entity_signals` (structured "why" — the AI's primary read substrate)
```sql
CREATE TABLE entity_signals (
  id                     BIGSERIAL PRIMARY KEY,
  organization_id        UUID NOT NULL,
  entity_type            TEXT NOT NULL,
  entity_id              BIGINT NOT NULL,
  signal_kind            TEXT NOT NULL,           -- 'return_reason', 'buyer_note', 'exception_why', 'test_fail_reason', ...
  reason_code            TEXT,
  notes                  TEXT,
  severity               SMALLINT,
  occurred_at            TIMESTAMPTZ NOT NULL,
  workflow_definition_id INTEGER,
  node_id                TEXT,
  source_ref             TEXT,                    -- external natural key for idempotent derivation
                                                  -- (platform message/note id, or sha of order-id+note
                                                  -- text when the platform gives no id); NULL for
                                                  -- internal chokepoint emitters
  meta                   JSONB,
  notes_tsv              tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(notes,'') || ' ' || coalesce(reason_code,''))) STORED,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- org-led indexes for per-node aggregates + (org, node_id, signal_kind, reason_code);
-- GIN on notes_tsv; enforce + CHECK/registry on signal_kind; also emit to ops_events
-- Idempotency for derived/external signals:
--   CREATE UNIQUE INDEX ux_entity_signals_source_ref
--     ON entity_signals (organization_id, signal_kind, source_ref)
--     WHERE source_ref IS NOT NULL;
-- Emission is INSERT ... ON CONFLICT DO NOTHING — fresh path, heal sweep, and
-- backfills are all free no-ops on rows already emitted.
```

**Day-one emitters (all four, locked):** returns/warranty reasons (incl. `linkReturnedSerial`
context), receiving exceptions + triage outcomes, tech test-fail reasons (via `recordTestVerdict`
+ governed reason_codes), buyer notes/messages from the eBay/Amazon order sync connectors —
the last one via the **mirror-derivation standard** below, never inline in a connector.

#### Emitter standard: two classes, one contract

- **Internal chokepoint emitters** (returns/warranty, receiving exceptions, test-fail): call
  `recordEntitySignal` inside the existing domain chokepoint transaction. `source_ref` NULL;
  idempotency rides the chokepoint's own guarantees (clientEventId / event-gated).
- **External-source emitters** (buyer notes, and any future platform-derived signal): **signals
  are a projection of the local mirror, never a side-effect of the connector.**

  > **Correction (2026-07-03, Phase 0 scouting):** the marketplace-order mirror is the legacy
  > **`orders`** table (INTEGER PK; eBay sync writes it via `createOrUpdateOrderFromEbayTracking`,
  > `src/lib/ebay/sync.ts`), **not `sales_orders`** as sketched below — `sales_orders` is the
  > Zoho-side mirror with a UUID PK and is never touched by the eBay sync. Verified: eBay's
  > Fulfillment `getOrders` response carries `buyerCheckoutNotes` but the sync currently drops it
  > and there is no payload jsonb to recover it from, so Phase 1's "verify the fields land"
  > becomes a minimal mirror extension (an `orders.buyer_note` column persisted by the sync).
  > `entity_signals.entity_type='ORDER'` therefore anchors `orders.id`. Also note the eBay sync
  > is exceptions-first (only orders whose tracking matches an open `orders_exceptions` row),
  > so day-one buyer-note coverage is scoped to those orders until the sync widens.

  1. *Connectors stay dumb* — sync keeps upserting into the mirror (`orders`; see correction
     above); the only connector-side task is verifying the note/message fields actually land in
     the mirrored row (read-mostly verification, not new sync logic).
  2. *Derivation emits from the mirror* via `recordEntitySignal`, on two triggers (the Nextiva
     webhook-realtime + catch-up-poll split): a **fresh path** — fire-and-forget hook in the sync
     orchestrator after upsert, `tapWorkflow` semantics (best-effort, never fails a sync) — and a
     **heal path** — a nightly reconcile sweep under `withCronLock` re-scanning recently-synced
     mirror rows and emitting anything missed. Signals derive from a local table, so the sweep
     needs no API calls, the system is self-healing (drift cannot accumulate), and a full
     backfill is just the sweep over a wider date range.
  3. *Idempotency* via `source_ref` + the partial unique index above; double-emission between
     fresh and heal paths is structurally impossible.
  4. *Tenancy*: derivation writes through `withTenantTransaction` with the org from the sync
     connection — never inferred from the payload.
  5. *Rollout*: each external emitter is gated per-tenant via `resolveForOrg`.
  6. *No interpretation at ingest*: buyer notes land raw as `signal_kind='buyer_note'`; semantic
     bucketing into `reason_code` is the later Jetson classifier's job, never Phase 1 scope.

**Platform sequencing:** **eBay first.** Amazon buyer notes are PII behind SP-API restricted data
tokens (RDT) — real approval latency — so Amazon buyer-note ingestion is a fast-follow behind the
same derivation module, and Phase 1 never stalls on it (the three internal emitters carry zero
connector risk).

### 2.4 `node_surfaces` (Studio graph ↔ rails/surfaces linkage)
```sql
CREATE TABLE node_surfaces (
  id                     BIGSERIAL PRIMARY KEY,
  organization_id        UUID NOT NULL,
  workflow_definition_id INTEGER NOT NULL,
  node_id                TEXT NOT NULL,
  feed_key               TEXT NOT NULL,
  role                   TEXT NOT NULL DEFAULT 'inbox',
  config                 JSONB NOT NULL DEFAULT '{}'
);
```

### 2.5 `insight_links` (seeded + anonymized benchmarks/comparisons)
```sql
CREATE TABLE insight_links (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID,                     -- NULL for global/seeded benchmarks
  linkage_type    TEXT NOT NULL,            -- 'industry_benchmark', 'power_user_comparison', 'suggestion_seed'
  subject_kind    TEXT NOT NULL,            -- 'node_type', 'feed_key', 'signal_kind'
  subject_ref     TEXT,
  metrics         JSONB,
  source          TEXT NOT NULL,            -- 'seeded' | 'anonymized_agg'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
Phase 1: hand-author seeded rows for the used-electronics-reseller vertical (test-fail %, return %,
receive→list days) so `/operations` and the assistant can answer "you vs typical" day one.

### 2.6 `agent_mutations` + `agent_mutation_affects` (AI proposals, atomic apply, learning)
```sql
CREATE TABLE agent_mutations (
  id                BIGSERIAL PRIMARY KEY,
  organization_id   UUID NOT NULL,
  proposed_by_staff_id INTEGER,              -- real staff or null for pure AI
  ai_chat_session_id TEXT REFERENCES ai_chat_sessions(id),
  status            TEXT NOT NULL DEFAULT 'proposed',  -- proposed | under_review | approved | applied | rejected | reverted
  mutation_kind     TEXT NOT NULL,
  payload           JSONB,
  review_notes      TEXT,
  applied_by        INTEGER,
  applied_at        TIMESTAMPTZ,
  extra_audit       JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_mutation_affects (
  id                 BIGSERIAL PRIMARY KEY,
  organization_id    UUID NOT NULL,
  agent_mutation_id  BIGINT NOT NULL REFERENCES agent_mutations(id) ON DELETE CASCADE,
  target_kind        TEXT NOT NULL,          -- 'staff', 'workflow_node', 'feed_membership', 'entity_signal', 'node_surface', ...
  target_ref         TEXT NOT NULL,          -- canonical ref or composite key
  role_in_mutation   TEXT
);
```

**Trust list (day one, locked):** auto-apply = view-layer only (`staff_rail_exclusion.*`,
`feed_membership.state`, `entity_signal.insert`, `node_surface.config`). Review-gated = anything
touching masters (`staff.create`, `workflow.edge/node`, status transitions). Every apply →
guarded helpers inside one transaction + `recordAudit` + ops_event + Ably. Draft-scoped graph edits
apply to the draft without review (the draft is itself the safety layer; publish is the gate).

**Key properties across all tables** (unchanged): second discriminator axes validated in app-layer
registries (not rigid enums); bounded working sets (history lives in domain spines + ops_events);
org-led keys enable future `PARTITION BY LIST (organization_id)`; additive evolution = data not
migrations.

---

## 3. The AI layer (new — the heart of the v2 plan)

### 3.1 Read-tool registry
A registry of small, typed, org-scoped, Deps-injectable read tools — the AI's eyes:

- `get_signals_by_node(node_id, kind?, range?)`, `get_top_reasons(scope, range)` — entity_signals aggregates
- `get_unit_journey(serial|ref)` — item_workflow_state + ops_events + timeline spines
- `get_feed_state(feed_key, staff?, station?)` — memberships minus exclusions
- `get_graph(definition_id)` / `get_node_detail(node_id)` — workflow definition + live positions
- `get_benchmarks(subject_kind, subject_ref)` — insight_links
- `get_kpis(range)` — org-scoped operations analytics
- `search_notes(query)` — tsvector full-text over signals
- `get_mutation_history(...)`, `get_chat_history(...)` — the AI reading its own past

Same discipline as the workflow/facts registries: adding a capability = registering a tool, no
migration. This registry is later exposed via **MCP** for power users/external agents — same tools,
second transport.

### 3.2 Server agent loop
`POST /api/assistant/*` — withAuth-gated, org-scoped; Claude API tool-use loop over the registry;
persists turns to `ai_chat_sessions`/`ai_chat_messages`; emits `agent_mutations` when the user asks
for a change; streams UI tool calls (below) to the client.

### 3.3 App-shell assistant + client tools
`AssistantProvider` in the root layout (see §-2): right dock everywhere (chat + AI-edits tray),
`useAssistantContext` registry hook for page/station/selection context and per-page skill
fragments, and a **client-executed UI tool namespace**: `navigate(path, params)` (URL-as-state
makes every surface reachable), `highlight(ref)`, `focus_node(id)`, `set_lens(lens)`,
`set_zoom(z)`, `open_overlay(panel)`.

### 3.4 Learning loop (phase 1 shape)
Store everything (chats, mutations, affects, outcomes). Nightly cron aggregates entity_signals into
insight_links trends ("top return reasons by node, 30d"). Accepted/rejected mutation stats per
mutation_kind inform trust-list widening. No fine-tuning yet; when volume justifies it, the Jetson
pipeline trains narrow classifiers (buyer-note → reason_code), never the orchestration layer.

---

## 4. AI-first Studio refactor (rides Phase 3)

The Studio page is refactored from "editor with an inspector" to **"live process-flow display the
AI drives"**:

- **Canvas:** read-only live visualization (graph, item positions, surface occupancy via
  feed_memberships + node_surfaces, signal heat via entity_signals, staff assignments). Lens/zoom
  rules per `.claude/rules/display/monitor-and-canvas.md` unchanged (repaint overlays, never
  crossfade the graph).
- **Editing:** all structural editing via the assistant. AI edits apply to a **live draft**
  instantly (canvas reacts over Ably). `NodeConfigForm` / `DecisionRulesEditor` / Library
  drag-and-drop are removed from the primary UX; the merged dock keeps micro-tweaks (rename, one
  config field) on the focused node.
- **Dock:** the assistant dock **absorbs StudioInspector** — focused-node detail renders beneath
  the chat; issues/diagnostics surface as AI-readable context. One right rail; no double aside.
- **Testing:** **AI-narrated simulate + iterate** — reuse the existing Simulate panel (client-side
  dry-run, zero engine writes); the AI pushes fake/sample units through the edited draft, narrates
  the behavioral diff ("failed audio units now route to parts-harvest, not scrap"), flags
  diagnostics, and the user iterates conversationally ("what else would improve throughput here?").
- **Publish:** unchanged human gate — `studio.manage` + step-up auth + diagnostics gate. The AI can
  request publish; it cannot perform it.
- **Studio skill:** a registered prompt fragment (graph vocabulary, lens semantics, canvas-control
  tools) — not a custom-trained model (§-2).

---

## 5. Example surface: receiving triage (unchanged semantics, later phase)

- `feed_memberships` (`feed_key='receiving_triage'`) = shared default "all".
- `staff_rail_exclusions` = per-staff per-station dismiss (non-destructive).
- Transitions (NEEDS_MATCH ↔ ACTIVE ↔ DONE) = state flips on memberships.
- `receiving.pairing_state` / `triage_complete` remain SoT; memberships are projection.
- History = separate domain-linked pages over the receiving spine + ops_events + entity_signals
  (date/time + full-text), one Monitor variant, one Workbench variant.

---

## 6. Sync, chokepoints, and the apply path

**Shared surfaces** (`feed_memberships`, `entity_signals`, `node_surfaces`): app-level
write-through from domain chokepoints; registries per surface kind; `syncFeedMembership`,
`recordEntitySignal` etc. Deps-injectable and DB-free unit-testable.

**Personal layer:** dismiss = insert exclusion; restore = delete exclusion. Very cheap.

**Agent mutations:** AI (or user via AI) creates the proposal row (linked to the chat session) +
lean affects rows → trusted kinds auto-apply / draft-scoped graph edits apply to draft /
master-touching kinds await review → atomic transaction through guarded helpers (real staff
creation, workflow updates, signal inserts, membership/exclusion changes) → ops_event + extra
audit + Ably → canvas/dock react live.

All writes flow through existing chokepoints (`applyTransition` for status/graph, dedicated
helpers for staff/surfaces) so `item_workflow_state` + `ops_events` stay the SoT. Parent-delete
integrity via the established trigger family on master parents.

---

## 7. Rollout — the AI-first phased roadmap (supersedes v1 §7 ordering)

**Phase 0 — Schema wave.** Author the full lean table family in one migration wave
(`db-migration-author`): CHECKs, org-led indexes, enforce_tenant_isolation, delete triggers,
Drizzle models same PR. Plus the kind catalog / canonical-ref registry module.

**Phase 1 — AI read substrate.**
Wire `entity_signals` from all four emitters: the three internal chokepoints (returns/warranty,
receiving exceptions/triage, tech test-fail) plus buyer notes via the **mirror-derivation
standard** (§2.3 — connector verification only, derivation module + fresh hook + nightly heal
sweep, `source_ref` idempotency, eBay first / Amazon behind RDT as fast-follow). Build the typed
read-tool registry (§3.1) with DB-free unit tests. Seed `insight_links` for the reseller vertical.
Surface "you vs typical" on /operations.

**Phase 2 — Global English assistant.**
`AssistantProvider` + dock + `useAssistantContext` + per-page skill fragments. Server agent loop
(Claude API) over the read tools, persisted to ai_chat_sessions. Client UI tools
(navigate/highlight). Read/explain only — no writes yet. (Mind the F2 scan-hotkey collision; the
assistant binds cmd-K-style keys only.)

**Phase 3 — AI write path + AI-first Studio refactor (together).**
`agent_mutations` apply chokepoint with the view-layer trust list; draft-scoped graph editing;
Studio refactor lands here: dock absorbs inspector, manual structural editing demoted,
canvas-control tools, AI-narrated simulate loop, Ably-live draft reactions. Publish gate unchanged.

**Phase 4 — Operator rails cutover.**
Backfill shared memberships for receiving triage (+ other known queues); cut sidebars over to
memberships minus exclusions; bulk actions target the exclusion table (reuse SelectionActionBar).
The rails are now also the first surfaces the AI visibly manipulates for operators.

**Phase 5 — Learning loop + history pages + onboarding.**
Nightly signal→insight_links aggregation cron; mutation accept/reject stats → trust-list widening.
The two domain-linked history pages (Monitor timeline + Workbench list/inspector, date/time +
full-text). Template-first onboarding: seeded reseller-flow template + AI conversational refinement
for new tenants. MCP exposure of the tool registry for power users.

**Later:** Redis hot paths (comprehensive caching plan), anonymized cross-org benchmark
aggregation (multi-tenant), generative "describe your business → full graph" onboarding, narrow
fine-tuned classifiers on the Jetson pipeline.

Verification per phase: preserve existing e2e; add targeted tests for signal emitters +
aggregates, tool registry (DB-free), agent_mutations apply/revert, per-staff exclusions, realtime
reactions, simulate narration parity.

---

## 8. Open / product questions (post-interview residue)

- ~~Exact initial `mutation_kind` vocabulary + the canonical-ref grammar (one page spec before Phase 0).~~
  **RESOLVED 2026-07-03 — see §10 below; executable SoT is `src/lib/surfaces/registry.ts` +
  `src/lib/surfaces/canonical-ref.ts` (guard-tested).**
- Concrete seeded `insight_links` rows (metrics shapes for the reseller vertical).
- How "station" context is carried in feed_key vs. separate column/node for personal-view queries.
- Assistant dock interaction details on mobile (`/m/*`) — dock vs bottom sheet.
- History page default filters/date ranges per domain.
- When (and whether) per-tenant trust configuration graduates into the settings registry.

Everything else — AI-first interaction model, build order, trust list, signal emitters, runtime,
Studio refactor shape, dock merge, testing loop, onboarding posture, naming, additive strategy —
is locked per §-2 and §-1.

---

## 9. References & related

- `.claude/rules/polymorphic-tables.md` (the contract — all new tables obey it point-for-point).
- `.claude/rules/backend-patterns.md`, `.claude/rules/contextual-display.md`, `.claude/rules/display/*`.
- Existing spines: `ops_events`, `item_workflow_state`, receiving_line_facts,
  `ai_chat_sessions`/`ai_chat_messages`, `staff` + `staff_roles` + `staff_stations`, workflow
  nodes/edges/definitions, `reason_codes`.
- Plans: `schema-wide-polymorphic-refactor-plan.md`, `polymorphic-tables-database-refactor-plan.md`,
  ops-studio docs, reseller-flow skill.
- Code reads: receiving rails/feeds, workflow applyTransition + tap, Studio
  flow-metrics/definitions/Simulate panel, staff admin surfaces, scan-hotkey registry pattern
  (`src/lib/scan-hotkey/store.ts` — the model for `useAssistantContext`), order-sync connectors
  (buyer-note ingestion points).
- Reusable: RecentActivityRailBase + SelectionActionBar, registries (workflow/facts), atomic apply
  chokepoints, URL-as-state house rules (the navigation-tool payoff).

---

## 10. mutation_kind spec (Phase 0 resolution of §8's first open question — 2026-07-03)

Executable SoT: `src/lib/surfaces/registry.ts` (`MUTATION_KINDS`, guard-tested by
`src/lib/surfaces/registry.test.ts`, which pins the auto-apply list — widening it is a deliberate,
reviewed edit to both files). This section is the human-readable contract.

### Trust classes

| Class | Behavior | Safety layer |
|---|---|---|
| `auto` | Applies immediately in `applyAgentMutation`, no review. **View-layer only** (§-2 locked). | Projection tables only — never touches masters; every apply still gets recordAudit + ops_event + Ably. |
| `draft_scoped` | Applies immediately **to a workflow DRAFT** (`is_active = FALSE` version). | The draft itself: publish stays the human gate (step-up + diagnostics). Revert = `status='reverted'` + inverse edit on the draft. |
| `review` | Lands as `status='proposed'`; a human approves/applies via the review queue. | Human review; applies through the same guarded helpers. |

### Day-one kinds

| mutation_kind | Trust | target_kind | Payload sketch |
|---|---|---|---|
| `staff_rail_exclusion.insert` | auto | `staff_rail_exclusion` | `{ staffId, station, feedKey, entityType, entityId }` |
| `staff_rail_exclusion.delete` | auto | `staff_rail_exclusion` | `{ staffId, station, feedKey, entityType, entityId }` |
| `feed_membership.set_state` | auto | `feed_membership` | `{ feedKey, entityType, entityId, state }` (state ∈ active\|needs_match\|done) |
| `entity_signal.insert` | auto | `entity_signal` | `recordEntitySignal` input (registry-validated signal_kind) |
| `node_surface.set_config` | auto | `node_surface` | `{ nodeSurfaceId, configPatch }` |
| `workflow_draft.add_node` | draft_scoped | `workflow_node` | `{ definitionId, node: { id?, type, x?, y?, config } }` |
| `workflow_draft.remove_node` | draft_scoped | `workflow_node` | `{ definitionId, nodeId }` (removes its edges too) |
| `workflow_draft.update_node_config` | draft_scoped | `workflow_node` | `{ definitionId, nodeId, configPatch }` |
| `workflow_draft.add_edge` | draft_scoped | `workflow_edge` | `{ definitionId, source, sourcePort, target }` (one port → one target) |
| `workflow_draft.remove_edge` | draft_scoped | `workflow_edge` | `{ definitionId, edgeId }` |
| `workflow_draft.set_annotations` | draft_scoped | `workflow_definition` | `{ definitionId, annotations }` |
| `node_surface.create` | draft_scoped | `node_surface` | `{ definitionId, nodeId, feedKey, role, config }` (draft definitions only) |
| `node_surface.delete` | draft_scoped | `node_surface` | `{ nodeSurfaceId }` (draft definitions only) |
| `staff.create` | review | `staff` | `{ name, roleIds, stationKeys, … }` → real `staff` + `staff_roles` + `staff_stations` rows (§-1 Q1) |
| `staff.assign_station` | review | `staff` | `{ staffId, stationKeys }` |
| `reason_code.create` | review | `reason_code` | `{ flowContext, code, label, … }` |
| `setting.update` | review | `setting` | `{ key, value }` (settings-registry key) |

Deliberately **not** offered day one: `feed_membership.create/delete` (the sync layer's job — the
AI flips state, it does not fabricate feed rows), `workflow.publish` (never a mutation kind — the
AI may *request* publish, only a human performs it), and any `serial_unit.*` status transition
(status changes stay behind `transition()`/`applyTransition()`; exposing them to the agent is a
later, separately-reviewed decision).

### Canonical-ref grammar (Q11, now pinned)

`src/lib/surfaces/canonical-ref.ts`. Two forms, `:`-separated lower_snake segments:

- **Axis form** `<table>:<axis>:<value>:entity:<id>` — a row scoped by a vocabulary axis, e.g.
  `feed_memberships:feed_key:receiving_triage:entity:123`.
- **Entity form** `<table>:entity:<id>` — a direct row ref, e.g. `serial_units:entity:9041`.
  TEXT-keyed rows use the raw id string (e.g. `workflow_nodes:entity:n-<uuid>`).

`agent_mutation_affects.target_ref` always holds one of these; `parseCanonicalRef` never throws.

### Widening protocol

A kind's trust class widens (review → draft_scoped → auto) only when its accepted/rejected stats
(from `agent_mutations`) justify it, via a PR that updates `MUTATION_KINDS` **and** the pinned
list in `registry.test.ts` together. Per-tenant trust config is a later upgrade (§8) — the
registry is global for now.

---

**End of revised plan (v2).** The platform is AI-first and English-first: the read substrate and
global assistant come before everything; the write path and the Stitch-style Studio land together;
rails, history, and learning follow. Studio is a live preview the AI drives — never a system the
user has to learn.
