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

## Status snapshot — 2026-06-28 (Parts 2–5 completion pass; verified against the live DB + green tsc + cross-org canary)

**Part 3 (RLS) — critical path DONE and PROVEN.**
- **E1 keystone LIVE & verified:** `app_tenant` role exists with `rolbypassrls=f, rolsuper=f`; runtime connects via `TENANT_APP_DATABASE_URL`. Recorded as a secret-free, idempotent grants-reaffirm migration (`2026-06-28_app_tenant_grants_reaffirm.sql`) so a fresh tenant DB reproduces E1 after the one manual password-bearing `CREATE ROLE` step.
- **E2 FORCE complete for genuine business tables:** the final two unforced business tables (`organization_integrations`, `photo_exports`) are now ENABLE+FORCE+policy (`2026-06-28_enforce_tenant_isolation_business_tail.sql`). Live: **173 tables FORCEd, 181 with a complete `tenant_isolation` policy.** Every still-unforced table is by-design (global reference `bose_*`/`failure_modes`/`part_compatibility`/`return_dispositions`, global STN, `hermes_*`, `training_runs`, identity/HR Phase-F, system-nullable `audit_logs`/`stripe_events`/`order_ingest_queue`).
- **Cross-org canary GREEN (4/4):** enforced-role invariant (runtime role ≠ BYPASSRLS), RLS isolates a FORCEd table with no WHERE filter, reason_codes slice isolates, every FORCEd table has a complete policy. RLS genuinely bites — `src/lib/tenancy/cross-org-isolation.test.ts` under the app_tenant DSN.
- **C route-scoping:** the static audit's "critical/high" were overwhelmingly false positives — pre-auth identity routes (`/api/auth/*`, cross-org by design), cron fan-out (Phase D), webhooks (resolve-org-from-payload), or no-DB external proxies. The one genuine inline-DB leak (`sku-catalog/flag-missing`) is now `withTenantTransaction`-wrapped. Critical 27→23, tenantWrapped 320→329.
- **C5 engine tables off neon-http:** `item_workflow_state`/`workflow_runs`/`workflow_node_stats`/`zoho_locations` now route through `withTenantDrizzle` (GUC-carrying) at every app call site; the cross-org snapshot cron + tap null-org discovery stay on the owner pool by design. All four confirmed FORCE-safe.
- **D crons — COMPLETE:** 25 crons → 16 per-org-correct (14 prior + 2 newly fanned-out: `sourcing/scan`, `staff-goals/history`), 7 global-by-design (commented), and the last 2 (`sourcing/scour`, `google-sheets/transfer-orders`) now fan out via `forEachOrgWithProvider('ebay'|'google_sheets', …, {includeUsavTransitional})` — orgs without the provider are correctly skipped, USAV preserved. **Zero deferred crons remain.**
- **D1 Ably org-isolation — COMPLETE (was already built; verified + tightened):** every channel is `org:{orgId}:*` from the single `src/lib/realtime/channels.ts` builder; the token endpoint (`/api/realtime/token`) scopes Ably `capability` to the caller's org namespace (derived from `withAuth`, never the body) and fails closed on any non-prefixed resource; per-staff bridges granted for that staffId only. 0 sites needed structural conversion; 6 stale doc refs corrected. No global channels; no server/client name desync.
- **Phase F identity/billing — code-complete (RLS blocker now removed):** signup→org→billing path verified working — `/api/auth/signup` (org + admin + roles in one tx), org provisioning (`seedDefaultWorkflowForOrg` template clone + `seedOrgCatalog` + admin role), billing (`/api/billing/{checkout,portal,webhook}`, idempotent signature-verified webhook, `plans`/`entitlements`/`subscriptions`, trial needs no subscription row). Closed the one real gap (tenant-creation `recordAudit` + `AUDIT_ACTION.ORG_CREATE`). **Remaining is human-owned ops** (set live Stripe env in Vercel — runbook exists) **or genuinely-XL product** (account-backed self-signup, dunning, SSO, the Tracker/Ops/Studio price-ladder split) — bounded with seams, not code-incomplete.

**Isolation PROVEN, guard GREEN:** cross-org canary 4/4 green; tenancy-guard now **exits 0** (`app_tenant` bypassrls=false, **177 FORCEd tables live, all with complete USING+WITH CHECK policies**). The guard gained a documented allowlist ratchet (`scripts/tenancy-guard-exemptions.ts`): of the ~272 static flags, **11 routes were genuinely GUC-wrapped** (including 2 *real* cross-tenant leaks found in the sweep — `staff/schedule/week` + `week/copy` read `FROM staff` with no org filter, now wrapped + org-predicated), 4 were detection-fixed (`withTenantDrizzle` now recognized), and **257 were classified into honest exemption categories** (182 helper-safe-delegation, 31 no-DB-false-positive, 22 cross-org-by-design, 21 pre-auth-identity, 1 owner-pool-admin) — verified leak-free. A new un-exempted violation still fails the guard (ratchet preserved). Also completed the WITH CHECK clauses the concurrent STN/`training_runs` FORCE waves left off (`2026-06-28k`), so the canary's policy-completeness check is green.

**Part 2 (Studio) — COMPLETE:** decision-node (`§1.6`) editor finished (editable rule table + read-only published readout, house-style, persists via `onUpdateNodeConfig`). **Stage 2 done:** `@gorules/zen-engine-wasm` installed (WASM build, lazy/guarded, `serverExternalPackages`) with a ZEN-expression evaluator behind `DECISION_ENGINE_ZEN` (default OFF) — parity-tested against the in-house evaluator, byte-identical Stage-1 behavior when off.

**Parts 4–5 (cleanup):** Wave 1 hygiene done. **Wave 2 done** — knip dead-code baseline gate wired into CI (`scripts/knip-gate.mjs` + `knip-baseline.json`, deterministic cold-cache, fails only on NEW dead code). **Wave 3** — the ~12 status-SoT consolidation was already largely in lib (~20 registries); converged the last 2 inline unit-status tone-map duplicates onto `src/lib/unit-status.ts`. Wave 4 god-splits: `useFbaStationInput` (992→364L+3 hooks) and `PhotoLibraryGrid` (952→147L+13 modules); other named targets were already split. Residual >800L: `StudioWorkspaceContext` (orchestration hub), `Icons.tsx` (registry — keep).

**Engine flags ENABLED + verified:** `UNIFIED_ENGINE_APPLY_TRANSITION` and `UNIFIED_ENGINE_FULFILLMENT_TAPS` are now ON (`.env`) — the engine is the live, parity-verified chokepoint (**118/118 engine tests green with the flag on**). `DECISION_ENGINE_ZEN` stays OFF (the new ZEN path, opt-in). Prod activation is the same one-env-var set in Vercel.

**Phase F COMPLETE (not just code-present):** account-backed self-signup wired into the signup tx (org→account→membership→staff, the applied identity-layer migration); **dunning** in the Stripe webhook (`invoice.payment_failed`→`past_due`, recovery clears it, idempotent); **SSO OIDC finished** end-to-end (id_token claim validation + `account_identities`/membership/`staff_roles` provisioning + `email_verified` anti-takeover gate) — only the JWS *signature* check is a documented v2 stub (spec-safe in the auth-code flow over server-to-server TLS). Remaining is human-owned ops (set live Stripe env in Vercel — runbook exists) and the Tracker/Ops/Studio price-ladder split (a product decision; the gate mechanism is in place).

**Final gates (all green):** whole-repo `tsc --noEmit` **0 errors**; **tenancy-guard exit 0**; **cross-org canary 4/4**; **155/155** workflow+billing+identity/SSO+tenancy tests; `package-lock.json` synced (`npm ci` passes). Wave 4 god-splits: every `src/components` file is now under 800L (`Icons.tsx` 801→13L barrel + 7 category modules; `StudioWorkspaceContext` 803→255L + 7 hooks; `PhotoLibraryGrid` 952→147L; `useFbaStationInput` 992→364L). ~21 files remain in the 501–800L band (the diminishing-returns tail of "no file >500L"; all named Wave-4 targets done).

---

## Status snapshot — 2026-06-22 (verified against the live DB, not assumptions)

**Part 1 (engine):** 1.0 (real lock + unpark + Studio recovery), 1.1 (`applyTransition` + `recordTestVerdict` reference), 1.2 (receiving dual-spine de-drift), 1.4 (`listed` + `packed` taps), 1.5 (`shipped` tap — shipped LIVE, not the observe-only-first variant), and 1.6 **Stage 1** (a `decision` node + in-house evaluator) are DONE. Phase **1.3** (one guarded writer): `hold`/`release`, `parts-sort`, `order-release`, `returns-intake`, `rma-restock`, `allocate`, `fba-ship-units`, **`putaway`**, and the **`pack/ship` SHIPPED flip** now route through `transition()`. The `pick/scan` override and `returns/undo` raw writes are deliberate guard-bypasses (force-pick / compensating rewind), kept raw by design. 1.6 **Stage 2** (GoRules ZEN) and **1.7** (non-serialized enrollment, the state-mapping doc, read-model re-point) remain.

**Part 3 (RLS) — substantially further along than the tables below imply:**
- **E1 keystone DONE:** `app_tenant` role (NOBYPASSRLS) + two-pool split are live (`TENANT_APP_DATABASE_URL` set; `src/lib/db.ts` `tenantPool`). Verified isolating via a real cross-org probe (org's rows under its GUC, 0 under another org) — RLS genuinely bites.
- **105 of 126 tenant tables FORCEd & verified** (started at 9) — including the ENTIRE high-traffic core (`orders`, `items`, `sku`, `sku_catalog`, `sku_stock`, `sku_stock_ledger`, `inventory_events`, `work_assignments`, `locations`, `packages`, `order_unit_allocations`, `invoices`, `fba_*`, `station_activity_logs`, `rma_authorizations`, `picking_sessions`, `suppliers`, `warehouses`, `product_manuals`, `testing_results`, `repair_*`, …). Cross-org canary green; direct probes confirm 0 cross-org rows (orders 2695/0, sku_stock 2654/0, work_assignments 5782/0, …). Applied via 11 guarded, per-table-fault-tolerant migrations (leaf cohorts 1–3, reason_codes, ready_cohort, core_lowfanin, nullable_business, sku_platform_ids, core_usav_fallback, loudfail_verified, remaining_business).
- **The 21 still-unforced are ALL by-design exclusions:** external-writer `hermes_*`; system `pipeline_*`/`training_*`; global-by-design STN (`shipping_tracking_numbers`/`shipment_tracking_events`); nullable analytics `operations_kpi_*`; external `google_photos_*`; engine `zoho_locations` (C5); system-nullable `audit_logs`/`order_ingest_queue`/`stripe_events`.
- **~37 routes GUC-wrapped** across 6 workflow waves + manual on the status-writers (`putaway`, `status`, `condition`, `pack/ship`, `orders/delete`, `mark-received(+po)`, `assignments/sku-search`, …); tsc clean throughout.
- **Residual (does NOT block "switches flipped"; for tenant-#2 isolation-completeness):** ~36 genuine "wrap" routes remain (most of 600+ are already helper-safe — the static audit under-counts); C5 (engine tables off `neon-http`); D1 (Ably); Phase F (identity/billing).

The Part 3 table further down is the original (2026-06-13) plan; trust this snapshot + `docs/tenancy/coverage.generated.json` + the auto-memory `tenancy-part3-live-state` for current truth.

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
