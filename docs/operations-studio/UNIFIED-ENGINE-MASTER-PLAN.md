# Unified Engine Master Plan — Node-Graph Direction + Long-Term Codebase Roadmap

**Companion to [`/DISCOVERY.md`](../../DISCOVERY.md) (Phase 0 facts).** This is the forward plan:
how to expand the engine in the **node-graph** direction, the **Operations Studio** roadmap, the
**codebase-wide long-term backlog**, and the **cleanup waves** — sequenced for a sellable
multi-tenant SaaS.

> Scope note: this is a *plan*, not code. Per the Phase-0 gate, no application code is changed
> until this is approved. **Git protocol (resolved):** all work happens on **`main`** (standing
> project rule). The brief's `refactor/unified-engine` branch is *not* used — strangler safety
> comes from per-call-site feature flags, app green at every commit, not from a long-lived branch.

---

## Part 0 — Operating principles (non-negotiable)

1. **Expand the existing node-graph engine; never build a second engine.** No XState, no parallel
   `states/transitions` tables. Canonical tables stay: `workflow_definitions/nodes/edges`,
   `item_workflow_state`, `workflow_runs`, `workflow_node_stats`, `station_definitions`.
2. **Strangler-fig + branch-by-abstraction.** Introduce one `applyTransition()` helper behind an
   interface; route call sites through it one at a time behind a feature flag; delete the old path
   only after per-site parity is verified. App builds + tests green at every commit.
3. **Reversibility + audit.** Every state-changing path writes one append-only event
   (`inventory_events` + `workflow_runs`). Additive changes; flag-gated cutovers; observe-only mode
   before any irreversible seam.
4. **No destructive ops.** No dropping tables/data, no history rewrite, no force-push, no FORCE-RLS
   on a table whose routes aren't org-scoped yet.
5. **Tenant-safety is a release gate, not a feature.** The engine cutover and the RLS keystone
   advance together; **do not onboard tenant #2 until E1 + receiving-core FORCE are verified**.

---

## Part 1 — Node-graph engine expansion (the core)

**Current truth:** engine is LIVE on the intake half (`receive → test → repair-loop → test →
list_ebay`); units **pool at `list_ebay`**; `pack`/`ship` advance with zero engine involvement;
`advanceItem` runs on a **no-op lock**; there is **no unpark path**; and unit status is written
through **~20+ ungated paths** plus a guarded `transition()` plus the engine observer — three
spines that never share a transaction.

The expansion has two intertwined goals: **(A) collapse the status spines into one guarded writer**
and **(B) wire the dormant fulfillment tail** — done in strangler order so the app never breaks.

### 1.0 — Pre-flight hardening (before Phase 1 ships to prod) · P0
- [ ] **Real per-unit lock.** Replace `NULL_LOCK` (`src/lib/workflow/contract.ts:146`,
      `advance.ts:55`) with an Upstash/Redis `AdvanceLock` keyed `wf:advance:{serialUnitId}`. Confirm
      `UPSTASH_*` env is configured (also needed by rate-limiting — see §3). *Effort: M.*
- [ ] **Unpark / recovery path.** Add an endpoint + Studio action that resets a `blocked`/`error`
      `item_workflow_state` to `active` (with an `inventory_event` + `workflow_runs` entry). Without
      it, errored units silently die. *Effort: S.*
- [ ] **Behavioral contract = the tests.** Treat `advance.test.ts` / `station-nodes.test.ts`
      (first-edge-wins, terminal=done, await=park, unknown-type=error) as the engine spec; extend
      them as semantics are added. *Effort: S.*

### 1.1 — Phase 1: the `applyTransition()` reference implementation · P0
Introduce the single mutate-and-tap chokepoint helper (branch-by-abstraction seam):

```
applyTransition({ unitId, event, input, actor, orgId }):
  load unit FOR UPDATE
  decision = domainHandler(unitState, input)        // pure fn → { nextStatus, eventType, placement?, logs }
  guard(unitState.current_status → nextStatus)       // reuse src/lib/inventory/state-machine.ts allow-list
  UPDATE serial_units.current_status = nextStatus
  recordInventoryEvent(eventType, diff, placement)
  tapWorkflow({ unitId, event, input })              // engine observes, advances graph position
```

- [ ] Build `applyTransition()` (new module under `src/lib/workflow/` or `src/lib/inventory/`).
- [ ] **Convert `src/lib/tech/recordTestVerdict.ts`** (already taps + writes `qa_status`/serial
      status) to call it. It's live, idempotent, reversible (a verdict can be re-entered) → the
      reference impl for everything after. *Effort: M.*
- [ ] Fix the brief-divergence while here: decide `PASS → TESTED` vs `GRADED`, and
      `TESTING_FAILED → ON_HOLD` vs `IN_REPAIR` (currently `ON_HOLD`). Make the graph + enum agree.

### 1.2 — Phase 2: kill the dual-spine drift · P0
- [ ] Fold `src/app/api/receiving/lines/[id]/status/route.ts:129–153` (writes BOTH
      `receiving_lines.workflow_status` AND `serial_units`, bypassing guard + tap) into
      `applyTransition()`.
- [ ] Fold the two receiving producers (`scan-serial/route.ts:236`,
      `mark-received-po/route.ts:622`) into the same helper. Intake is cheap to replay, no money.
      *Effort: M.*

### 1.3 — Phase 3: one guarded writer for `serial_units` · P0/P1
- [ ] Migrate the **~20 ungated raw `current_status =` UPDATEs** to route through `transition()`
      (not yet the full engine — just collapse to one guarded path). Order:
      `hold.ts` / `allocate` / `release` / `returns.ts` (money-adjacent but reversible) →
      `pick/scan` / `putaway` / `parts-sort.ts` / `rma/authorizations.ts` / fba ship-units.
- [ ] Enumerate the exact site list in a tracking issue; treat as the strangler backlog. *Effort: L.*

### 1.4 — Phase 4: wire the dormant fulfillment tail (safe side first) · P1
- [ ] `list_ebay` `listed` tap (reversible, no carrier) — finally drains the `list_ebay` pile-up.
- [ ] `pack` `packed` tap (reversible, in-warehouse).
- [ ] Add `LISTED` handling: it's currently *not* a `serial_status` value — decide whether to add
      it to the enum or keep it graph-only + a listing-table join. *Effort: M.*

### 1.5 — Phase 5: the irreversible ship seam (last) · P1
- [ ] `src/app/api/pack/ship/route.ts` — add `ship` `shipped` tap in **observe-only/log-only mode**
      first (log what the engine *would* route), reconcile against actual for a full cycle, **then**
      enable. Highest blast radius; carrier custody is irreversible. *Effort: M, gated.*

### 1.6 — The decision / placement layer (GoRules ZEN, staged) · P1
The 22 hardcoded placement/routing sites move out of app code into declarative decision nodes.
**Resolved direction: GoRules ZEN is the long-term target** (operator-editable JDM decision tables
are the multi-tenant-SaaS requirement); adopt it in stages behind a swappable node interface so it
never blocks or risks the engine cutover:
- [ ] **Stage 1 — interface first:** add a `decision` node type whose `config` holds a rule table
      (`{ when: {grade, channel, disposition}, then: {placement, target_table, port} }`), with a
      **minimal in-house evaluator** in `port()`/run(). Unblocks Part 1; proves the seam. *Effort: M.*
- [ ] **Stage 2 — swap to ZEN:** replace the evaluator with **`@gorules/zen-engine-wasm`** (WASM
      build, for Vercel serverless portability — *not* the native napi binding) and embed
      `@gorules/jdm-editor` in Studio, *behind the same node interface*. No engine change. Store JDM
      graphs per-org/versioned (mirror `workflow_definitions` semantics). *Effort: M; do a runtime
      spike first.*
- [ ] Author the first decision graphs: `pass_qc` grade→staging; `fail_qc`→repair-queue; channel
      FBA→fba-prep vs eBay→self-ship (with `target_table`/`target_queue` outputs the action layer reads).

### 1.7 — Engine model gaps to close · P1/P2
- [ ] **Non-serialized inventory** can't enroll (`item_workflow_state.serial_unit_id` NOT NULL +
      unique). Decide: keep engine serial-only, or generalize the enrollment key.
- [ ] **Reconcile the two state spines** conceptually: `serial_units.current_status` (domain truth)
      vs `item_workflow_state.current_node_id` (graph position). Document the relationship; ensure
      `applyTransition` keeps them coherent.
- [ ] **Re-point parallel read models** that re-derive lifecycle buckets independently:
      `src/features/operations/`, `src/lib/outbound-state.ts`, `src/lib/unshipped-state.ts`.

---

## Part 2 — Operations Studio roadmap

Studio is the per-tenant authoring/observe surface; much of it already exists (graph canvas,
draft/publish, diagnostics gate, Live lens, station builder with `workflow_node_id` binding).

- [ ] **Phase E–G: editable canvas UI** (per `NODE_WORKFLOW_IMPLEMENTATION_PLAN.md`) — finish
      node add/remove/connect on React Flow, config sheets per node type. *P2, L.*
- [ ] **Decision-node editor** — config sheet for the `decision` node (§1.6); later the JDM editor.
- [ ] **Live + Flow² lenses** — wire `workflow_runs` + `workflow_node_stats` into queue-depth /
      time-in-node / SLA-breach visuals; the `slaHours` on `test-grade`/`repair` already feed this.
- [ ] **Station ↔ node binding UX** — surface `station_definitions.workflow_node_id` so a station
      page is visibly "the UI for node X"; collapse the 25+ duplicate panels into one config-driven
      `StationPanel` (see Cleanup Wave 3).
- [ ] **Recovery/triage view** — list `blocked`/`error` items with the unpark action (§1.0).
- [ ] **Entitlement tiers (SaaS):** gate Studio by plan — `Tracker` (read-only lifecycle),
      `Ops` (engine runs templated graphs), `Studio` (full graph + decision editing). Enforce at the
      route layer via the existing permission registry + `organization_feature_flags`.
- [ ] **Template library:** system-owned default graphs (generalize `Standard refurb-and-list`) a
      new tenant clones into its own `workflow_definitions` — onboarding = clone + edit, zero deploy.

---

## Part 3 — Multi-tenant SaaS critical path (the gating constraint)

**This is the true blocker for selling, and it interlocks with the engine cutover.** RLS is
currently *decorative*: 68 tables have policies but the app role has `BYPASSRLS`, so FORCE is inert.
Sequence (from `docs/tenancy/multi-tenancy-execution-plan.md`):

| Phase | Item | Pri | Effort |
|---|---|---|---|
| **E1 — KEYSTONE** | Provision non-`BYPASSRLS` `app_tenant` role; wire `TENANT_APP_DATABASE_URL`; two-pool split; retire `neondb_owner` for app queries. CI guard `scripts/tenancy-guard.ts` already armed | **P0** | M |
| **C** | Route GUC-scoping sweep: **244/572 wrapped; ~243 critical + ~158 high remain** unscoped (real leaks: receiving-lines CRUD, work-orders writes, serial-unit moves/grades, admin PIN-reset) | **P0** | XL |
| **C5** | Migrate `item_workflow_state`/`workflow_runs`/`workflow_node_stats` + `zoho_locations` off neon-http onto `withTenantDrizzle` (**neon-http can't see the GUC** → blocks engine-table FORCE) | **P1** | L |
| **B** | `org_id` columns missing/nullable on 18 tenant tables + ~49 children; backfill + NOT NULL; `schema.ts` reconciliation | **P1** | XL |
| **E2** | Per-table FORCE rollout, gated by route audit + per-table canary (sequence: E1 role flip → C-scope a table → FORCE it) | **P0** | M |
| **D** | Session-less webhooks & crons org-threading: 18 crons → per-org fan-out + `withCronLock`; 5 `TODO(multi-tenant)` integration syncs (Zoho/Ecwid/Sheets/shipping) stop using `transitionalUsavOrgId()` | **P1** | M |
| **D1** | Ably realtime org-isolation — channels + token endpoint + ~94 pub/sub sites | **P1** | M |
| — | Per-org integration credentials (`organization_integrations` keyed; per-tenant Zoho/eBay/Amazon vault); SSO provider-key off the transitional `stripe` vault scope | **P1** | M |
| **F** | Identity/membership/lifecycle (signup→org→billing) — deferred until E1+E2 stable | **P2** | XL |

**Gated migrations already written, not applied:** FBA FNSKU composite PK (`*.gated`), SKU catalog
composite UNIQUE (`*.gated`), `app_tenant` role (`*.template`), RLS leaf-cohort 1/2/3 +
`reason_codes` enforcement (`*.template`). Apply per the E1→C→E2 order, never ahead of route scoping.

> **Hard release gate:** do **not** onboard tenant #2 until E1 + E2 (receiving core FORCE) are
> verified and a cross-org canary is green.

---

## Part 4 — Codebase-wide long-term TODO (consolidated backlog)

Harvested from real repo signals (TODO/FIXME, dormant code, gated/template migrations, test gaps).
Grouped by area; **P0/P1 = on the sellable-v1 critical path.**

### Engine / Workflow
- [ ] **P0** Wire fulfillment tail + `applyTransition` (Part 1) — the headline.
- [ ] **P1** Phase D Upstash distributed lock (replace `NULL_LOCK`).
- [ ] **P1** Workflow-lock production-scenario test (double-scan race).
- [ ] **P2** Vision service wiring (APIs ready; UI pending) — `vision/` + `src/lib/vision*`.
- [ ] **P3** Carrier webhooks (UPS/FedEx/USPS) — built but dormant; paid, so keep behind cron-polling.

### Tenancy / SaaS (Part 3) — P0/P1 critical path.

### Tests
- [ ] **P0** Cross-org isolation E2E on mutation endpoints (proves RLS actually blocks).
- [ ] **P0** Engine integration tests for the newly-wired production taps.
- [ ] **P1** Unit coverage: receiving (17 fns), tech/inventory (13 fns), shipping (7 fns).
- [ ] **P1** E2E for `repair-service/*`, `tech/*` mutation routes.
- [ ] **P2** Feature-flag path tests (`WARRANTY_LOGGER`, `MOBILE_RECEIVING_PIPELINE_V2`, `RECEIVING_PHYSICAL_STATE_FIRST`).

### Features (functional debt)
- [ ] **P2** Work-orders queue: receiving/FBA/repair/stock queues disabled (pending-orders-only backfill) — `work-orders/route.ts:609`.
- [ ] **P2** Receiving history "unpaired placeholders" legacy + fallback queries.
- [ ] **P3** Photos Phase E: retire deprecated `photos.url` column → storage-only + content routes.

---

## Part 5 — Cleanup / tech-debt waves

Run as `knip`/`tsc`/build-gated waves (the established protocol), each independently revertible.

### Wave 1 — Repo hygiene (P2, S) — quick wins, no risk
- [ ] `.gitignore`: add `*.tsbuildinfo`, `tsconfig.*.tsbuildinfo`, `*.tmp.tsbuildinfo`, `.tmp/*.png`,
      `firebase-debug.log`, `.printers.tmp.txt`.
- [ ] Remove root junk: stray PNGs (`admin-integrations-dedup.png`, `ebay-card.png`,
      `settings-no-chevron-no-title.png`), `.tmp` artifacts, leftover `tsconfig.*.tmp.tsbuildinfo`.
- [ ] Delete or `410 Gone` break-glass endpoints: `api/setup-db`, `api/drizzle-setup`,
      `api/migrate-process`, `api/diagnose-migration`, `src/lib/setup-guard.ts` (verify no CI/bootstrap use).

### Wave 2 — Dead code (P2, L)
- [ ] Activate the dead-code baseline in CI (infra exists, not wired).
- [ ] Triage the **160+ knip-reported unused files** (known noise here = redundant `export default`
      + locally-used exported types — verify before deleting; keep design-system types).

### Wave 3 — Duplicate / parallel SoTs (P1, L) — *do this alongside Part 1*
- [ ] **~12 lifecycle-status representations** → converge on `serial_units.current_status` +
      engine; retire per-domain ad-hoc status logic as each call site is strangled.
- [ ] **`serial_units.current_location` (free text) vs bin FK** → make `bin_contents`/`inventory_events.bin_id`
      canonical; drop/relegate the text column with a migration + backfill.
- [ ] **Inventory V2 dual paths behind flags** — once the engine path is verified, retire the legacy branch.
- [ ] **315 status string-literal sites** → typed state codes (follows from the registry in Part 1).
- [ ] **315→0 inline tone maps** consolidating on `src/lib/unit-status.ts`.

### Wave 4 — God-component splits (P1/P2) — pairs with the `StationPanel` consolidation
- [ ] `StationFbaInput.tsx` (1242L), `FbaShipmentEditorForm.tsx` (1089L),
      `UnfoundQueueDetailsPanel.tsx` (1054L), `IncomingSidebarPanel.tsx` (937L),
      `SkuTestingPanel.tsx` (923L). Target: no `src/components/*` file > 500L.
- [ ] **25+ near-duplicate station/sidebar panels → one config-driven `StationPanel`** over
      `station_definitions.config` + a per-domain block registry (the Studio §2 station work).

---

## Part 6 — Sequencing & dependency graph

```
        ┌──────────────── TENANCY CRITICAL PATH (Part 3) ────────────────┐
        │  E1 app_tenant role ─▶ C route-scope ─▶ C5 engine tables ─▶ E2 FORCE │
        └───────────────────────────┬───────────────────────────────────┘
                                     │ (engine tables must be GUC-safe before FORCE)
   ENGINE (Part 1)                   ▼
   1.0 lock + unpark ─▶ 1.1 applyTransition(recordTestVerdict)
        ─▶ 1.2 kill dual-spine ─▶ 1.3 one guarded writer
        ─▶ 1.4 wire list/pack ─▶ 1.5 ship (observe-only→live)
        ─▶ 1.6 decision layer (parallel, after 1.1)
   STUDIO (Part 2) ── follows the engine; entitlement tiers gate exposure
   CLEANUP — Wave 1/2 anytime; Wave 3 rides Part 1; Wave 4 rides Studio
```

**Critical-path one-liner:** `app_tenant role` + `applyTransition reference impl` are the two
unblockers. Everything else hangs off them.

### Definition of done
- A new station/branch/routing rule = **new rows + a decision-table edit, zero new app code**.
- Every unit state change flows through **one chokepoint**, writes **one audit event**, and (for
  serialized units) keeps `serial_units.current_status` and the graph position coherent.
- RLS is **enforced** under `app_tenant`; a cross-org canary proves isolation; tenant #2 can onboard.
- No `src/components/*` file > 500L; the ~12 status SoTs collapsed to one; `knip`/`tsc`/build green.

---

## Appendix — packages
- **Keep:** `@xyflow/react` (canvas), `drizzle-orm`, `postgres`/`@neondatabase/serverless`.
- **Add when Phase 1.0 lands:** an Upstash/Redis client for the real `AdvanceLock` (confirm `UPSTASH_*` env).
- **Add at §1.6 Stage 2:** `@gorules/zen-engine-wasm` (WASM build, serverless-portable) +
  `@gorules/jdm-editor` (React decision-table editor). Both MIT. Runtime spike first.
- **Do NOT add:** `xstate` (wrong layer — see DISCOVERY §2); and do **not** use the native
  `@gorules/zen-engine` napi binding on Vercel — prefer the WASM build.
