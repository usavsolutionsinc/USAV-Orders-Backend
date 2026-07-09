# Universal-feed AI-first execution run — status report

> Living report for the Phase 0–3 execution run (2026-07-03) of
> `docs/todo/universal-feed-polymorphic-plan.md`. One section per HUMAN GATE.
> Nothing in this run has been applied to any database.

---

## HUMAN GATE 0 — Phase 0: schema wave + vocabulary spine (COMPLETE, awaiting review)

### Deliverables

**Migrations (authored only — apply via `/db-migrate`, in filename order):**

| File | Table(s) | Notes |
|---|---|---|
| `2026-07-03j_feed_memberships.sql` | feed_memberships | plan §2.1 + state/tone CHECKs, 7-parent delete-trigger family, enforce_tenant_isolation |
| `2026-07-03k_staff_rail_exclusions.sql` | staff_rail_exclusions | plan §2.2, staff FK CASCADE, 7-parent trigger family, enforce |
| `2026-07-03l_entity_signals.sql` | entity_signals | plan §2.3 verbatim incl. `source_ref` partial-unique idempotency index + generated `notes_tsv` (GIN), 7-parent trigger family, enforce |
| `2026-07-03m_node_surfaces.sql` | node_surfaces | plan §2.4; **node_id deliberately FK-free** (Studio graph-save replaces workflow_nodes wholesale — an FK would sever surfaces on every draft save; documented gap per contract pt 5) |
| `2026-07-03n_insight_links.sql` | insight_links | plan §2.5; **deliberate tenancy exception**: nullable org + hand-written FORCE RLS (tenants read global+own, write own-only; GUC default auto-stamps tenant-path writes) |
| `2026-07-03o_agent_mutations.sql` | agent_mutations + agent_mutation_affects | plan §2.6; status CHECK; session FK SET NULL (TEXT, matches ai_chat_sessions PK); affects junction CASCADE |

Wave was renamed d–i → **j–o** mid-run: the parallel AI-search session took
`2026-07-03d_entity_search_docs.sql`. Nothing applied, so renames were free.

**Drizzle:** all 7 tables modeled at the tail of `src/lib/drizzle/schema.ts`
(discriminator values in comments, partial/GIN/DESC indexes mirrored,
`notes_tsv` marked `generatedAlwaysAs` so it is excluded from `$inferInsert`).

**Vocabulary spine:** `src/lib/surfaces/registry.ts` (entity types w/ parent +
ops_events mapping, feed keys, signal kinds, node-surface roles, insight axes,
**mutation kinds w/ trust classes**) + `src/lib/surfaces/canonical-ref.ts`
(grammar `<table>[:<axis>:<value>]:entity:<id>`, parse never throws) +
18 guard tests (`npm run test:surfaces`) that pin the registry byte-identical
to the migration CHECK lists and delete-trigger coverage.

**Plan doc:** §8's first open question resolved → new **§10 mutation_kind
spec** (17 kinds: 5 auto / 8 draft-scoped / 4 review; widening protocol);
§2.3 amended with a dated correction (see deviations #1).

### Documented deviations from the plan sketch

1. **The marketplace-order mirror is `orders`, not `sales_orders`** (§2.3
   correction in the plan doc). Scouting verified: the eBay sync writes the
   legacy `orders` table and currently **drops `buyerCheckoutNotes`**; there
   is no payload jsonb anywhere to recover it. Phase 1 therefore adds a
   minimal `orders.buyer_note` column persisted by the sync (mirror change
   only), and `entity_type='ORDER'` anchors `orders.id`. Day-one caveat: the
   eBay sync is exceptions-first, so buyer notes are captured only for orders
   with an open exception until the sync widens.
2. `workflow_definition_id` on feed_memberships/entity_signals gets a real FK
   `ON DELETE SET NULL` (plan sketch: bare INTEGER). Header-documented.
3. `node_surfaces` + `agent_mutations` gain `created_at`/`updated_at` per the
   contract skeleton; `agent_mutations` staff columns get FKs `SET NULL`.
   Header-documented.
4. `feed_memberships.state` CHECK is exactly `active|needs_match|done`
   (plan §5's three states) — new states require a CHECK redefinition.
5. Delete-trigger functions match the house `2026-07-01j` shape exactly (no
   `organization_id` filter). A tenancy skeptic recommended adding
   `AND organization_id = OLD.organization_id` as defense-in-depth;
   **declined for now** to stay byte-consistent with the established family —
   safe because all 7 parent PKs are global sequences and tenant-path RLS
   scopes the child delete. Revisit if any parent ever moves to per-org ids.

### Adversarial verification (5-skeptic panel, all findings resolved)

- **Confirmed + fixed:** rollback recipes in j/k/l would have orphaned the
  parent-table triggers (production-outage script) → now `DROP FUNCTION …
  CASCADE` first. Vacuous `insight_links_global_source_chk` → replaced with a
  GUC `DEFAULT` on `organization_id` (closes the owner-path fail-open where a
  forgotten org column would mint a globally-visible row). Drizzle mirror
  gaps (6 missing partial/GIN indexes, 4 missing DESC markers, writable
  generated column) → fixed. `canonical-ref` accepted `NaN`/`-5`/`1.5`
  numeric ids and `axis === 'entity'` → rejected + tested.
- **Clean lanes:** locked-decision fidelity (trust list, §2.3 idempotency
  index byte-identical, all four emitters representable, Q11 grammar parses),
  polymorphic-contract compliance (all 8 points), insight_links RLS semantics
  (worked through per-command: tenants read global+own, cannot write/update/
  delete global rows), `to_tsvector('simple',…)` immutability for the stored
  generated column.

### Gate suite (honest results)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npx eslint src/lib/surfaces src/lib/drizzle/schema.ts --max-warnings=0` | ✅ my files clean; 1 pre-existing warning (`genericColumns`, schema.ts ~580, not this change) |
| `npm run test:surfaces` | ✅ 18/18 |
| `npm run test:auth` | ✅ 57/57 |
| `npm run test:ds-guards` | ⚠️ 4 failures, **all in files outside this change** (warehouse/rma pages, tech-page redesign — in-flight human work; this change contains no UI) |
| `npm run knip` | ⚠️ baseline refreshed to include the new registry exports (consumed in Phases 1–3); current delta findings are **all from the parallel AI-search session's files**, zero from this change |
| `npm run audit-route-auth:check` + manifest test | ✅ (manifest re-emitted; absorbed one pre-existing in-flight cron route `/api/cron/search-outbox`, not this change) |

### Apply order (when you choose to)

`npm run db:migrate:dry` then `npm run db:migrate` — the wave is
self-contained, order j→o, no data movement, all idempotent. After apply:
`npm run tenancy:coverage` (insight_links will — correctly — show as a
documented exception).

---

## HUMAN GATE 1 — Phase 1: AI read substrate (COMPLETE, awaiting review + migration apply)

### Deliverables

1. **`recordEntitySignal` + `emitEntitySignalSafe`** (`src/lib/surfaces/record-entity-signal.ts`):
   registry-validated (kind, entity type, kind↔entity pairing, external⇒source_ref required /
   internal⇒forbidden), writes signal **+ ops_event in one transaction** (own tenant tx, or the
   caller's client under a **SAVEPOINT guard** — a failed emit can never poison/roll back the
   caller's domain write), `ON CONFLICT` against the **named** source_ref arbiter. 7 DB-free tests.
2. **Internal emitters wired (all additive, never-fail):**
   - Returns: `linkReturnedSerial` (post-commit, beside the workflow tap) +
     `importSalesOrderByNumber` (in-tx, gated on first/changed link so repeats never
     double-count) — `return_reason`.
   - Warranty: `denyClaim` → `warranty_denial` with the governed reason code.
   - Receiving: `recordReceivingException` → line-level `exception_why`;
     `createUnmatchedReceiving` (lookup-po) → carton `exception_why` (NO_PO / CARRIER_MISMATCH);
     `completeTriage` → `triage_outcome` (emit gated on the FIRST completion via prior-state
     capture; re-click re-stamp semantics unchanged).
   - Tech: `recordTestVerdict` → `test_fail_reason` for TESTING_FAILED (sev 2) / TEST_AGAIN
     (sev 1), guarded by `eventCreated` so clientEventId replays never re-emit.
3. **Buyer-note mirror derivation (eBay only, §2.3 standard):** migration
   `2026-07-03p_orders_buyer_note.sql` (+ Drizzle) — the sync now persists
   `buyerCheckoutNotes` via COALESCE in both upsert branches; derivation module
   (`src/lib/surfaces/buyer-note-derivation.ts`, 6 tests) emits `buyer_note` signals with
   `ebay-note:<orderPk>:<sha16>` source_ref idempotency; **fresh path** = awaited never-throw tap
   in the sync orchestrator (awaited because serverless freezes un-awaited work); **heal path** =
   nightly `/api/cron/signals/buyer-notes-heal` (house cron contract, registered in
   `CRON_JOBS` + trigger map + `vercel.json` @ 09:15 UTC); per-tenant gate
   `isBuyerNoteSignals` (flag `buyer_note_signals` / env `BUYER_NOTE_SIGNALS`, default off).
4. **Read-tool registry** (`src/lib/assistant/tools/`): 11 org-scoped, Deps-injected,
   Zod-schema'd tools (`get_signals_by_node`, `get_top_reasons`, `get_unit_journey`,
   `get_feed_state`, `get_graph`, `get_node_detail`, `get_benchmarks`, `get_kpis`,
   `search_notes`, `get_mutation_history`, `get_chat_history`) + a single runner chokepoint
   (unknown-tool → permission → validate → run, org always from ctx). MCP-forward entry shape.
   9 tests incl. an every-tool org-threading sweep + phantom-column regression.
5. **Seeds + readout:** `2026-07-03q_insight_links_reseller_seeds.sql` (4 idempotent global
   rows: test-fail %, return %, receive→list days, one suggestion seed — all marked
   `editable_seed`); `GET /api/operations/benchmarks` (`operations.view`) +
   `getBenchmarkComparison` (actuals from inventory_events, degrade-not-fail on insight_links);
   "You vs typical" SectionCard on /operations analytics (Monitor rules, DS-guard clean).

### Adversarial panel findings (all confirmed ones fixed)

- **Critical (fixed pre-report):** in-tx signal failure would have poisoned the caller's
  transaction → silent rollback of `completeTriage`/`importSalesOrderByNumber` domain writes
  while returning success. Fixed with a SAVEPOINT guard + regression tests.
- **High (fixed):** phantom `inventory_events.created_at` in `get_kpis`, `get_unit_journey`
  AND `getBenchmarkComparison` (real column is `occurred_at`) — would have 42703'd at runtime;
  fakes masked it. Fixed + regression assertions added in both suites.
- **Fixed:** duplicate-emission vectors (`importSalesOrderByNumber` repeat, `completeTriage`
  re-click) that would inflate top-reason aggregates; `get_chat_history` returning oldest-N
  instead of newest-N; benchmarks route perm (`dashboard.view`→`operations.view` to match every
  `/api/operations/*` sibling) + NaN `rangeDays` → 500; heal-cron missing `console.error`;
  orchestrator tap un-awaited on serverless; bare ON CONFLICT arbiter named; error state now
  rose + Retry (was indistinguishable from empty); tooltip keyboard a11y; migration-header
  inaccuracy.
- **Explicitly clean lanes:** tenancy (every statement org-anchored; cross-org definitionId
  probes return found:false), fresh-vs-heal double-emission structurally impossible,
  `linkReturnedSerial`/`recordTestVerdict`/`denyClaim` once-only semantics verified, cron
  skeleton byte-conform, seeds ON CONFLICT semantics verified safe, DS/typography/Monitor rules.

### Deploy-order requirement (IMPORTANT)

Apply migrations **j→q before (or with) deploying this code**:
- `2026-07-03p` before the eBay-sync deploy — the upsert now references `orders.buyer_note`
  unconditionally; code-first would break eBay order creation until applied.
- `2026-07-03l` (entity_signals) before real traffic hits the emitters — emits fail safe
  (SAVEPOINT + warn) but every signal is dropped until the table exists.

### Gate suite (honest results)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| eslint (all Phase 1 files) `--max-warnings=0` | ✅ clean (pre-existing `USAV_ORG_ID` import error in warranty/mutations.ts and console warns in ebay/sync.ts predate this change) |
| `test:surfaces` 31 · `test:assistant` 8 · `test:operations-journey` 14 · `test:workflow` 96 · `test:receiving-exceptions` 4 · `test:warranty` 41 · `test:auth` 58 | ✅ all pass |
| `npm run test:ds-guards` | ✅ 12/12 |
| `npm run knip` | ✅ no new dead code (baseline includes registry exports consumed in later phases + the parallel AI-search session's files) |
| `audit-route-auth:check` + manifest | ✅ (re-emitted; 742 routes) |

### Demo (once migrations are applied)

- `npm run test:surfaces && npm run test:assistant` — signal + tool behavior end-to-end DB-free.
- Enable `BUYER_NOTE_SIGNALS=true` (or per-org flag row) → run "Sync now" on eBay → buyer notes
  appear as `entity_signals` rows; `curl /api/cron/signals/buyer-notes-heal` (Bearer CRON_SECRET)
  reports `{emitted, duplicates}`.
- /operations → Analytics → "You vs typical" section renders seeded benchmarks against your
  actuals (test-fail %, return %).

---

## HUMAN GATE 2 — Phase 2: global English assistant (COMPLETE, awaiting review + demo)

### Deliverables

1. **Server agent loop** (`src/lib/assistant/agent-loop.ts`): Claude API (`@anthropic-ai/sdk`
   0.110.0, `claude-opus-4-8`, adaptive thinking, streaming via `messages.stream` +
   `finalMessage`) manual tool-use loop over the Phase 1 read registry — org/staff/permissions
   strictly from the authenticated ctx, hard 8-turn cap, tool failures surface as `is_error`
   results the model routes around, `pause_turn` handled, prompt-cache discipline (stable system
   core under `cache_control`, volatile page context after the breakpoint), narration
   accumulates across turns so streamed text === persisted text. UI tool namespace
   (`navigate`, `highlight` live; `focus_node`/`set_lens`/`set_zoom` declared as stubs for
   Phase 3) forwarded to the browser and acknowledged to the model. 8 DB-free loop tests.
2. **`POST /api/assistant/chat`**: `withAuth` + NEW `assistant.chat` permission (registry +
   manifest test + emitted manifest), strict Zod body, house rate limit
   (`ASSISTANT_CHAT_RATE_LIMIT`, default 25/min), SSE out (`meta`/`delta`/`tool`/`ui_tool`/
   `error`/`done` + 15s keep-alive pings), `maxDuration = 300`, turns persisted org-explicitly
   to the existing `ai_chat_sessions`/`ai_chat_messages` via `tenantQuery` (leading-assistant
   history windows trimmed — the raw window could 400 the API).
3. **`AssistantProvider` + dock**: mounted in the root layout on every route; right-side
   collapsible dock (named z tokens `z-panel`/`z-fab`, desktop-only overlay — mobile dock is an
   open §8 question), chat UI per house style (Button primitive, typography tokens, 3-layer
   chips, HoverTooltip), empty **AI-edits tray** section, suggestion chips, localStorage open
   state. Keyboard: **cmd/ctrl+J** (caps-lock-proof, skips editable fields when closed) — never
   F-keys; verified no collision with CommandBar's cmd+K or the F2 scan-hotkey store.
4. **`useAssistantContext`** registry hook (module-scope LIFO store modeled on scan-hotkey,
   `useSyncExternalStore`, 3 tests): pages register `{ page, station, selection, mode, skill }`.
   Wired on **/operations** (KPI/benchmark fragment), **/studio** (flow-display fragment +
   focused-node selection), and the **packing station** (station Q&A fragment) — fragments live
   in one reviewed module (`src/lib/assistant/page-skills.ts`).
5. **Client UI tools**: `navigate(path, params)` → `router.push` (URL-as-state; `//host`
   protocol-relative paths rejected — stored-prompt-injection redirect hardening), `highlight(ref)`
   → window CustomEvent. **Ably plumbing**: dock subscribes to the org/session channel
   (`getAiAssistSessionChannelName`) ready for Phase 3 applies; token endpoint org-scoping verified.

### Adversarial panel (4 lanes; all confirmed findings fixed)

Fixed: protocol-relative `navigate` redirect; leading-assistant history 400; missing rate
limit; missing SSE heartbeat; unguarded `controller.close()` after client disconnect;
streamed-vs-persisted text divergence (+ turn separators); `maxDuration` 120→300; icon-only
Send button a11y name; Enter-mid-stream silently eating the draft; caps-lock-dead hotkey.
Verified clean: tenancy (cross-org session reads impossible — GUC + explicit predicate + RLS
cohort; same-org session model matches the existing ai_chat surface), prompt-injection surface
(client `skill` text gains nothing beyond the user's own permission-checked tool set), SDK
usage (thinking-block replay, tool_result shapes, `z.toJSONSchema` output, cache placement),
DS guards 12/12, provider order, Ably token capability scoping.
Deliberate notes: dock shares the `z-panel` band with slide-over panels (decide a dedicated
band when the dock absorbs the Studio inspector in Phase 3); no `recordAudit` on the read-only
chat route (consistent with `/api/ai/chat`; revisit when write tools land).

### Gate suite (honest results)

`npx tsc --noEmit` ✅ · eslint on all Phase 2 files ✅ · `test:assistant` 19/19 ✅ ·
`test:ds-guards` 12/12 ✅ · `test:auth` 59/59 ✅ · knip baseline ✅ ·
`audit-route-auth:check` + manifest ✅.

### To demo (needs your action)

1. Apply migrations j→q (`npm run db:migrate:dry` → `npm run db:migrate`).
2. Add `ANTHROPIC_API_KEY=sk-ant-…` to `.env` (I never touch `.env`; without it the route
   returns a clean 503 and the dock shows the error). Optional: `ASSISTANT_CHAT_RATE_LIMIT`.
3. `npm run dev` → any page → **⌘J** → ask *"why are units failing testing this week?"* on
   /operations (tool-grounded answer via get_top_reasons/get_kpis) and *"take me to a receiving
   PO"* (navigate tool moves the app). Grant `assistant.chat` to roles that should see the dock
   (admins have it implicitly per the registry model).

---

## HUMAN GATE 3 — Phase 3: AI write path + AI-first Studio refactor (FINAL)

### Deliverables

1. **`applyAgentMutation` chokepoint** (`src/lib/assistant/mutations/apply-agent-mutation.ts`,
   13 DB-free tests) — the single AI write path. Validates `mutation_kind` against the §10
   registry, enforces the trust classes:
   - **auto** (view-layer): `staff_rail_exclusion.insert/delete`, `feed_membership.set_state`,
     `entity_signal.insert`, `node_surface.set_config` — applied immediately.
   - **draft_scoped**: `workflow_draft.*` + `node_surface.create/delete` — applied to a
     NON-ACTIVE draft only (every writer runs `lockDraft` → 409 on the active version). The draft
     is the safety layer.
   - **review**: `staff.*`, `reason_code.create`, `setting.update` — land as `status='proposed'`,
     never applied here.
   One guarded write + the `agent_mutations`/`agent_mutation_affects` rows in ONE tenant
   transaction; `recordAudit` + `ops_event` + Ably fire post-commit best-effort. Every apply
   captures an **inverse descriptor** in `extra_audit`; `revertAgentMutation` replays it (draft
   edits and reversible view-layer changes; append-only signals + review proposals are not
   revertable).
2. **Guarded writers** (the FIRST writers for the Phase-0 projection tables):
   `src/lib/surfaces/feed-writes.ts` (staff-rail-exclusion / feed-membership-state /
   node-surface, 7 tests) and `src/lib/workflow/draft-graph-writes.ts` (granular
   add/remove/config/wire/annotations on a draft, one-port-one-target, node-type validation via
   the engine registry, full inverse capture, 7 tests).
3. **Write tools** (`src/lib/assistant/tools/write-tools.ts`, 6 tests): `propose_mutation` +
   `revert_mutation`, gated `studio.manage`, wired into the agent loop (permission-filtered
   before they're offered; a viewer never sees them). The system prompt teaches the trust model
   so the AI sets expectations ("applied to your draft" vs "queued for review") and never claims
   it can publish.
4. **Canvas-control tools live**: `focus_node`/`set_lens`/`set_zoom` drive the Studio URL view
   state through `useStudioWorkspace().setParams` (the dock is inside the provider). `navigate`
   /`highlight` unchanged.
5. **AI-first Studio refactor** (ops-studio skill): an **open** dock **absorbs the inspector**
   (`StudioNodeDetail` renders focused-node detail beneath the chat on /studio); the standalone
   w-72 aside is demoted only while the dock is actually open (`dockAbsorbsInspector =
   useAssistantDockOpen()`, exposed from `AssistantProvider`), kept as the 768–1024px fallback
   where the desktop dock is hidden. A **closed** dock leaves the classic aside/rail everywhere,
   so a permissioned first-run user still gets an inspector. Structural editing goes through chat;
   the underlying editing code is untouched, and the config micro-tweak stays manual per the plan.
   Publish is untouched — `studio.manage` + step-up + diagnostics gate, human-only.
6. **AI-edits tray live** (`AssistantEditsTray`): lists the draft's `agent_mutations`
   (applied/proposed/reverted) with a revert affordance, realtime via the org assist channel
   (`publishAssistantMutation` → `'assistant.mutation'`). Routes: `GET /api/assistant/mutations`
   (assistant.chat) + `POST /api/assistant/mutations/[id]/revert` (studio.manage).

### Adversarial panel — 4 lanes, all confirmed findings fixed

Panel: trust-model fidelity, tenancy/idempotency/revert, route/loop wiring, UI/Studio safety.
Pre-fixed while framing the panel: the per-draft tray filter (`target_ref LIKE` missed node/edge
edits → now filters on `payload->>'definitionId'`) and the 768–1024px inspector gap. The panel then
confirmed the following, each now fixed with a regression test:

- **CRITICAL — cross-org / publish-gate bypass on node surfaces.** `createNodeSurface` inserted
  `definitionId` unchecked (the FK to `workflow_definitions` is not org-composite and bypasses
  RLS), so the AI could declare a surface on another org's definition or on the ACTIVE version.
  Fixed: `createNodeSurface` and `deleteNodeSurface` now run a `lockOwnedDraft` /
  active-version check (`FOR UPDATE`, org-scoped) → 404 unknown / 409 active, mirroring
  `lockDraft`. Regression: 4 new `feed-writes` tests (lock-precedes-insert, 404, 409, delete-on-active).
- **`entity_signal.insert` reported "applied" on a dropped write.** It went through
  `emitEntitySignalSafe`, which swallows validation/DB failures, so a bogus `signalKind` still
  committed an `applied` mutation. Fixed: the chokepoint now calls `recordEntitySignal` (non-safe,
  SAVEPOINT-guarded) and maps `{ok:false}` → non-applied 400. Regression test asserts no
  `agent_mutations` row and no side-effects on invalid input.
- **Revert side-effects stamped a placeholder kind.** Every revert's audit/ops/Ably reported
  `mutationKind: 'entity_signal.insert'`. Fixed: the original `mutation_kind` is threaded out of
  the tx into the side-effects. Regression test asserts the real kind.
- **Write-tool domain failures weren't `is_error`.** A tool resolving `{ok:false}` was wrapped as
  a successful `tool_result`. Fixed in `runWriteTool` (maps `ok:false` → `is_error`), matching read tools.
- **Registry guards used `v in X`** (prototype-chain false positives, e.g. `'toString'`). Fixed:
  all five `is*` guards now use `Object.hasOwn`.
- **UI nits:** dock overflow (config section now `max-h-64 overflow-y-auto`), `as never` schema
  cast dropped, tray status pill drops vertical padding.

### Gate suite (honest results, re-run after all fixes)

```
npx tsc --noEmit                    → exit 0        ✅
eslint (8 changed files)            → exit 0        ✅
npm run test:assistant             → 56/56 pass    ✅  (+6 vs pre-panel: 4 node-surface guard, 2 chokepoint)
npm run test:ds-guards             → 12/12 pass    ✅
npm run test:auth                  → 60/60 pass    ✅
npm run test:surfaces              → 42/42 pass    ✅
npm run knip                       → 2514 = baseline (no new dead code)  ✅
npm run audit-route-auth:check     → manifest matches live source        ✅
```

---

## HUMAN GATE 4/5 — Phases 4 (rails cutover) + 5 (learning loop / history / onboarding)

Migrations `2026-07-03j..s` APPLIED to the live DB (411 on record, 0 pending). Phases 0–3 shipped
in the prior run; this run delivered the Phase 4/5 slice below.

### Shipped (7 of 9 planned sub-items, each tested + adversarially verified)

- **P5 — nightly signal→insight_links rollup cron** (`src/lib/operations/signal-rollup.ts` +
  `/api/cron/signal-insight-rollup` + migration `2026-07-03s` widening the `source` CHECK to add
  `org_rollup`). Owner-pool, org-preserving set-based upsert (same posture as `node-stats`); one
  per-org `org_signal_rollup` row per signal_kind with total + distinct reasons + top-5 reason
  codes. Registered in `vercel.json` + the cron registry. `signal-rollup.test.ts` (3).
- **P4 — reversible per-staff rail dismiss** (`src/lib/receiving/rail-exclusions.ts` +
  `/api/receiving/rail-exclusions` GET/POST/DELETE). **Replaces a DESTRUCTIVE shared delete** — the
  bulk rail action now writes a per-staff `staff_rail_exclusions` row (reuses the AI path's guarded
  writers), hiding a row from that operator only, reversibly. Relabeled "Dismiss" (neutral, not the
  red trash). `rail-exclusions.test.ts` (7).
- **P4 — durable exclusion read-filter** (`ReceivingFeedRail` choke point + `useRailExclusions` +
  `exclusion-feed-key.ts`). memberships-minus-exclusions applied at the single rail fetch seam;
  strictly additive (empty set = untouched); a stable exclusion signature rides the rail queryKey so
  a dismiss sticks across refetch. `exclusion-feed-key.test.ts` (4).
- **P5 — mutation accept/reject stats** (`trust-stats.ts` + `/api/assistant/mutations/stats`,
  `studio.manage`). Per-kind applied/reverted/rejected + acceptance rate + registry trust class —
  the evidence for trust-list widening. `trust-stats.test.ts` (3).
- **P5 — template-first onboarding** (`applyTemplateToOrg` in `template-catalog.ts`;
  `seedDefaultWorkflowForOrg` refactored to delegate; `isDefault` added to the Drizzle
  `workflowTemplates` model). `template-catalog.test.ts` (5).
- **P5 — entity_signals history substrate** (`entitySignalsToTimeline` adapter + `/api/entity-signals`
  read with `occurred_at` window + `notes_tsv` full-text + registry-validated discriminators).
  `entity-signals.test.ts` (4) + `entity-signals-read.test.ts` (4).
- **P5 — Signals ▸ History Monitor page** (`/signals` — `SignalsHistoryWorkspace`, org-scoped
  newest-first timeline, URL-param filters, degrade-not-fail). Registered in the nav
  (`operations.view`-gated).

### Deferred (2 of 9) — honest, not attempted to a lower quality bar

- **P4 — feed_memberships backfill/projection.** A backfill that mirrors the live triage/unbox
  membership into `feed_memberships` risks *drift* from the rich live rail logic (multi-source
  triage combine, per-staff viewed, priority ranks) and its only consumer today is the AI's
  `getFeedState` tool (which degrades gracefully to empty). Building it correctly is its own
  projector effort; a wrong backfill would feed the AI a stale queue view. Deferred with rationale.
- **P5 — Workbench signal master-detail page.** The reusable substrate (adapter + read + route) is
  done and tested; the second page (`?signalId=` picker + crossfading detail pane) is a
  `SupportWorkspace`-shaped follow-up. Shipping one solid Monitor page beat rushing two.

### Adversarial panel (4 lanes) — confirmed findings fixed

- **CTE top-reasons bug (medium, data quality):** a NULL-`reason_code` bucket stole a top-N rank
  slot, dropping the 5th real reason. Fixed — rank/distinct/top over non-NULL reasons only; total
  still includes the NULL bucket.
- **"All time" window no-op (medium, correctness):** `?.days ?? 30` swallowed the legitimate
  `null`, so "All time" silently applied 30 days. Fixed — distinguish not-found from null.
- **`count` over-claim (low):** the reused writer reports `ok` regardless of `rowCount`, so a
  re-dismiss still counted; doc corrected to "items accepted."
- **Doc/copy tidies:** adapter escalation comment, feed-key header (unbox Queue is `unboxQueue`),
  dismiss confirm copy (feed-wide).
- **Verified clean (concerns dropped):** no cross-tenant path (org/staff from ctx; owner-pool cron
  stamps source org, never NULL), no SQL injection (all params bound, discriminators
  registry-gated), the exclusion id-sign round-trips exactly, the upsert matches the partial-unique
  index, `activate` can't create a double-active definition, trust-stats math + `Object.hasOwn`
  guard correct, audit constants append-only. Known tradeoff (not a defect): a <1-RTT cold-load
  flash before the exclusion set loads — inherent to the deliberate client-post-filter design
  (chosen to avoid hot-path SQL surgery on the operators' busiest route); self-corrects, and warm
  navigation within the 15s staleTime doesn't flash.

### Gate suite (honest results, after all fixes + migration apply)

```
npx tsc --noEmit                    → exit 0        ✅
eslint (all changed files)          → exit 0        ✅
npm run test:operations-journey     → 17/17 pass    ✅  (+3 signal-rollup)
npm run test:universal-feed         → 20/20 pass    ✅  (rail-exclusions 7 + feed-key 4 + adapter 4 + template 5)
npm run test:surfaces               → 46/46 pass    ✅  (+4 entity-signals-read)
npm run test:assistant              → 59/59 pass    ✅  (+3 trust-stats)
npm run test:auth                   → 60/60 pass    ✅
npm run test:ds-guards              → 12/12 pass    ✅
npm run knip                        → 2523 = baseline ✅
npm run audit-route-auth:check      → manifest matches live source        ✅
npm run tenancy:guard:check         → passed (192 FORCEd tables)          ✅
db:migrate                          → 411 on record, 0 pending (j..s applied) ✅
```

**Behavior change to be aware of:** the receiving-rail bulk action is no longer a destructive
shared delete — it is now a reversible per-staff dismiss. This is the plan's explicit Phase 4
direction and is strictly safer, but it changes what "the pencil → select → primary action" does
for operators. Flagging for product awareness.

---
