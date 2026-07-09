# Hardcoded Status → Engine/Studio Migration Plan

**Companion to [`UNIFIED-ENGINE-MASTER-PLAN.md`](./UNIFIED-ENGINE-MASTER-PLAN.md).** That doc names this work in
**§1.7** ("re-point parallel read models that re-derive lifecycle buckets independently") and **Wave 3**
("~12 lifecycle-status representations · 315 status string-literal sites · 315 inline tone maps") but never
*enumerates* it. This doc is the enumeration + the sequenced migration: **every place a status code, lane,
transition, threshold, tone, or reason/disposition vocabulary is hardcoded outside the engine/registries, and
how each one becomes engine-driven and Studio-editable.**

> Scope note: this is a **plan**, not code. It obeys the Part-0 operating principles of the master plan —
> expand the one node-graph engine (no second engine), strangler-fig behind flags, additive + reversible,
> app green at every commit, tenant-safety is a release gate.

---

## 0. The worked example — why the testing board didn't update (the bug that motivated this)

A seeded outbound order (`TEST-UNSHIP-PENDING`, USPS tracking, `shipment_id` set) shows in the testing page's
shipping sidebar but **never moves into the TESTED lane**. Tracing it exposes the whole anti-pattern:

1. The board lane is **computed in the component**, not read from the engine:
   `UnshippedShelfBoard.tsx:86` → `rowState()` → `deriveFulfillmentState({ hasTechScan, outOfStock })`
   (`src/lib/unshipped-state.ts:64`). Vocabulary `PENDING | TESTED | BLOCKED` is a literal union (`:61`).
2. `has_tech_scan` is **raw SQL** in `src/app/api/orders/route.ts:421`
   (`COALESCE(sal_scan.scan_count,0) > 0`), where `sal_scan` counts `station_activity_logs` rows for the
   order's `shipment_id`. Nothing here consults `item_workflow_state` or `serial_units.current_status`.
3. To flip TESTED, `src/app/api/tech/scan/route.ts` must resolve the order **by tracking** and write a
   `station='TECH'` SAL row. That write path is **independent of the engine** — it observes nothing, the
   engine observes nothing of it.

So three separate hardcoded spines (a TS derivation, an SQL projection, and an ungated SAL write) have to
agree by coincidence for a row to change lane. They don't, and there is no single source of truth to blame.
**This is the pattern repeated ~40× across the codebase.** Fixing it generically — not just patching the one
board — is the task.

---

## 1. Taxonomy — three classes of hardcoded status

Everything we found sorts into three classes. They migrate differently, so the plan is organized by class.

| Class | What it is | Where it should live | # sites |
|---|---|---|---|
| **A — WRITE** | Status transitions + verdict→status maps + raw `current_status =` UPDATEs | The engine chokepoint (`applyTransition`/`transition`) + decision nodes | ~22 (13 still raw) |
| **B — READ / PROJECTION** | Parallel read-models that *re-derive* lifecycle buckets from SQL/booleans | Engine state projected once (`item_workflow_state` + canonical status), read everywhere | ~18 |
| **C — PRESENTATION** | status→label / tone / icon maps + redefined enums | Registry metadata keyed by the engine's status codes | 34 maps + ~315 inline |
| **D — REASON / DISPOSITION VOCABULARY** | Operator-chosen "why" code lists (substitution, short-pick, receiving-exception, repair-failure) hardcoded as TS arrays/unions | Tenant-owned `reason_codes` rows (one multi-vocabulary table) + decision-node rules for the behavior-bearing codes | 5 vocab · 6 sites · 3 inlined |

**Class B is the heart of your complaint** ("it should all go through the engine"). Class A is largely
already underway (flags ON). Class C is the cleanup tail (Wave 3 tone consolidation). The deep architectural
move is **B**: the boards must become *projections of engine state*, not independent derivations.

**Class D is the axis this enumeration adds to the original A/B/C.** A/B/C are all *system-derived* status;
**D is the one class that is operator-chosen and tenant-extensible by design** — so it terminates not in a lib
registry but in tenant-owned `reason_codes` rows (+ decision-node rules for the codes that drive branching). Its
defining tension — **descriptive vs behavior-bearing** — is set out in §2.2, and it runs as a parallel wave track
(§4 Class-D waves), not after B/C.

---

## 2. Target architecture — "no hardcoded status" defined precisely

"No hardcoded status codes, it all goes through the engine" resolves to four concrete invariants:

1. **One write chokepoint.** Every lifecycle status change flows through `applyTransition()` →
   `transition()` (guard + atomic `inventory_events`) → `tapWorkflow()` (engine advances graph position).
   No raw `current_status =`. *(Class A.)*
2. **One canonical state, projected — never re-derived.** A board lane / KPI bucket is a **projection of
   engine state** (`item_workflow_state.status` + `currentNodeId`, and/or `serial_units.current_status`),
   resolved by **one** library function, consumed read-only by every surface. No component or SQL fragment
   re-computes "is this tested / shipped / blocked." *(Class B.)*
3. **Vocabulary + thresholds are config rows, not literals.** Lane sets, status categories, SLA/stall hours,
   and routing rules live in `workflow_nodes.config` / `workflow_definitions` / decision-node rule tables —
   **edited in Studio**, versioned, draft→publish. A new lane or rule = new rows, zero new app code (master
   plan "Definition of done"). *(Classes A+B.)*
4. **Presentation reads the registry.** Every status→label/tone/icon comes from a lib registry keyed by the
   engine's status codes; components never redefine an enum or inline a tone map. *(Class C.)*
5. **Reason vocabularies are tenant-owned rows, not literals.** Every operator-chosen "why" (substitution,
   short-pick, receiving exception, repair-failure detail) comes from `reason_codes` rows scoped per org, read
   through one resolver; built-ins are *seeded* rows, not code arrays. A behavior-bearing reason's **branch**
   lives in a decision-node rule keyed on the code, never in an `if (reason === …)`. *(Class D.)*

### 2.1 The modeling gap to resolve first (be honest about it)

The engine today is **serial-unit-centric**: it enrolls `serial_units` and runs the intake→test→repair→
list_ebay graph. But the order/fulfillment boards (Unshipped PENDING/TESTED/BLOCKED, Shipped 7-state) are
keyed on **orders + station_activity_logs + shipping_tracking_numbers** — a *different spine the engine does
not model yet*. So "route the testing board through the engine" requires a decision:

- **Option 1 — Order-level workflow definition (recommended).** Model the order/fulfillment lifecycle as its
  own `workflow_definitions` graph (`order_received → tested → packed → staged → shipped → delivered`, with
  `blocked`/`exception` ports), enroll orders into `item_workflow_state` (needs the §1.7 non-serialized
  enrollment generalization — `serial_unit_id` is currently NOT NULL unique). Taps fire from the existing
  SAL writes (`TRACKING_SCANNED`, `PACK_*`, `SHIP_CONFIRM`) and carrier-status updates. Boards then read
  engine state. This is the true "everything through the engine" end state.
- **Option 2 — Canonical projection function (bridge).** Keep orders un-enrolled for now, but collapse the
  ~18 Class-B derivations into **one** `resolveOrderLifecycle(order)` lib function that the engine taps keep
  warm, and that every board/KPI/route reads. Mechanically identical reads everywhere; defers the enrollment
  question. Lower risk, ships first, and is the on-ramp to Option 1.

**Plan adopts Option 2 → Option 1**: ship the single projection function (kills the divergence + the bug),
then enroll orders into the engine graph behind a flag so the projection becomes a thin read of engine state.

### 2.2 Class-D principle — descriptive vs behavior-bearing (resolve before migrating)

Reason vocabularies do **not** all migrate the same way. Split every code list by **whether code logic branches
on the value**:

- **Descriptive** (display-only) — `SUBSTITUTION_REASONS`, repair-failure detail. Nothing in code reads the
  value except to label/tone it. **Fully customizable today, cheaply:** move the array to `reason_codes` rows +
  a generic resolver, point the picker at the tenant rows, prettify unknowns. `src/lib/fulfillment/substitution-reasons.ts`
  is the **reference shape** — `{code,label,tone,hint}` + `…Label()/…Tone()/isBuiltIn()` with a graceful
  `prettify()` fallback; every Class-D resolver mirrors it, and tone/label flow *from the resolver* so the
  component renders dumb (the Class-C rule, applied to reasons).
- **Behavior-bearing** — `RECEIVING_EXCEPTION_CODES` (drives the exception lane + a DB CHECK), short-pick reasons
  (drive the backorder/short flow), sku-stock movement reasons (map to an `inventory_events` category). A branch
  or constraint keys off the literal. **The vocabulary cannot be freed without moving the branch too** — else a
  custom tenant code silently does nothing. Migration = vocabulary→`reason_codes` rows **and** behavior→a
  decision-node rule that matches the code (the `disposition` fact in `decision-eval.ts`), or keep a small fixed
  **system** subset that code may switch on with custom rows layered on top for display only.

> Rule of thumb: a reason code is only "fully tenant-editable" once nothing in code switches on its string.
> Descriptive codes clear that bar immediately; behavior-bearing codes clear it only when their branch is a
> decision rule.

**One table, many vocabularies — keyed by a discriminator.** `reason_codes` today is *inventory-event–scoped*
(category CHECK `shrinkage|adjustment|sale|return|movement|initial|warranty_denial`,
`src/lib/schemas/reason-codes.ts:11`) — it is **not** a universal store yet. Do **not** absorb the other
vocabularies by exploding that CHECK (it pollutes the ledger semantics). Add a **`flow_context` discriminator**
(`inventory_event | substitution | short_pick | receiving_exception | repair_failure | verdict_detail |
warranty_denial`); the resolver filters by it, `category` stays scoped to `flow_context='inventory_event'`. An
optional `applies_to` (workflow_node_id / item-type tag) enables the per-node + per-data filtering that D3/D4
need. `warranty_denial` already lives in `reason_codes` (added `2026-06-06_warranty_claim_logger.sql`) — **the
proof the pattern works**; D1 generalizes it.

---

## 3. The comprehensive inventory

### 3.A — WRITE-side status logic (transitions + raw updates)

Source of truth: `src/lib/inventory/state-machine.ts` (`SERIAL_STATES` 21-state enum `:24`, `TRANSITIONS`
allow-list `:60`, `transition()` `:180`). Verdict map: `src/lib/tech/recordTestVerdict.ts:60`
(`VERDICT_TO_STATUS`). Chokepoint: `src/lib/workflow/applyTransition.ts:123`.

**Guarded already (keep):** `pick/scan:154`, `receiving/mark-received:280`, `orders/[id]/release:109`,
`pack/ship:307`, `fba/.../ship-units`, `fba/items/[id]/link-unit`, `lib/inventory/parts-sort:187`,
`recordTestVerdict` (flag ON).

**Raw bypasses to strangle (Class A backlog — master plan §1.3):**

| Site | Line | Change | Disposition |
|---|---|---|---|
| `api/pick/scan/route.ts` | 187 | → `PICKED` force-pick override | Deliberate guard-bypass; keep raw, document |
| `api/returns/undo/route.ts` | 95 | → dynamic `priorStatus` | Deliberate compensating rewind; keep raw |
| `api/receiving/lines/[id]/status/route.ts` | 214 | → TESTED/SCRAPPED/RETURNED fallback | Fold into `applyTransition` (flag already gates the happy path) |
| `api/serial-units/[id]/move/route.ts` | 110 | move | Route through `transition()` |
| `api/tech/test-result/route.ts` | 127,262 | `condition_grade` only | Not status — leave (grade is a separate axis) |
| `api/serial-units/[id]/grade/route.ts` | 85 | `condition_grade` only | Leave; it already hands off to `parts-sort` (guarded) |
| `lib/rma/authorizations.ts` | ~300 | RETURNED→STOCKED on ACCEPT | Confirm + route through `transition()` |

> Class A is ~90% done; the residue is the named raw sites. The new work here is small and already scoped by
> the master plan. **The bulk of *this* plan is Class B.**

### 3.B — READ-side parallel read-models (the core migration)

Every row below **re-derives lifecycle independently** and touches the engine **zero** times. Target: delete
the derivation, read the single projection (§2.1 Option 2 → 1).

| File:line | Hardcoded vocabulary / logic | Consumer |
|---|---|---|
| `lib/unshipped-state.ts:28` | 5-state `AWAITING_LABEL/PENDING/TESTED/PACKED_STAGED/BLOCKED` | Unshipped board |
| `lib/unshipped-state.ts:61,64` | 3-state `PENDING/TESTED/BLOCKED` + `deriveFulfillmentState()` | Unshipped/testing board lanes |
| `lib/unshipped-state.ts:151` | `UNSHIPPED_STATE_META` color map | board styling |
| `lib/outbound-state.ts:18` | 7-state `PACKED_STAGED/SCANNED_OUT/IN_CUSTODY/DELIVERED/EXCEPTION/PROCESS_GAP/ORPHAN` | Shipped board |
| `lib/outbound-state.ts:28,63,69` | `CUSTODY_CATEGORIES` set + terminal logic + 7-way branch | Shipped board |
| `lib/sql-fragments.ts:5` | `SHIPPED_BY_CARRIER_SQL` "is shipped" boolean | orders, operations, scan-tracking, check-tracking (4×) |
| `api/orders/route.ts:109` | `SHIPMENT_STATUS_CATEGORIES` 8-value enum | filters |
| `api/orders/route.ts:248,274,307,325` | `station IN ('PACK','TECH')` + `activity_type IN (...)` lifecycle joins | has_tech_scan/packed |
| `api/orders/route.ts:421` | `has_tech_scan` boolean (drives the bug) | board lane |
| `api/orders/route.ts:502,525,529,537,568` | `AFN` channel filter, awaiting/fulfillment/staged scopes, 72h stall | dashboard scopes |
| `components/unshipped/UnshippedShelfBoard.tsx:47` | `SHELF_ORDER = ['PENDING','TESTED','BLOCKED']` lane order | board |
| `components/unshipped/UnshippedTable.tsx:73,236` | `?stage=` filter + client-side `has_tech_scan` bucketing | board filter |
| `components/shipped/DashboardShippedTable.tsx:41` | `SHIPPED_LANE_ORDER` 7-lane order | shipped board |
| `components/shipped/details-panel/shipped-details-logic.ts:62` | hasTechScan→3-color pill | details header |
| `api/dashboard/operations/route.ts:28,48,56,65` | re-declared `CUSTODY_CATEGORIES` + activity-type velocity + repair non-terminal | ops KPIs |
| `lib/operations/journey-helpers.ts:21,168,286` | 5-spine model + UI→DB station map + activity-type enums | journey timeline |
| `api/scan-tracking/route.ts:77` · `api/check-tracking/route.ts:23` | re-inlined carrier-custody boolean | scan/lookup |
| `api/receiving-lines/route.ts:732,750,915` | delivery-state buckets `OUT_FOR_DELIVERY/IN_TRANSIT/...` | Incoming board |
| `api/receiving-lines/incoming/summary/route.ts:67,80,231` | same 3-category in-transit grouping | Incoming KPIs |
| `lib/dashboard-table-data.ts:138,237` | `excludePacked` / `fulfillmentScope` scope params | client fetchers |

**Activity-type + station vocabulary** repeated across these (must become one registry):
`TRACKING_SCANNED, FNSKU_SCANNED, PACK_SCAN, PACK_COMPLETED, FBA_READY, SHIP_CONFIRM` ·
stations `TECH, PACK, OUTBOUND, FBA, RECEIVING`. **Carrier categories** repeated (must be one SoT):
`LABEL_CREATED, ACCEPTED, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, EXCEPTION, RETURNED, UNKNOWN`.

### 3.C — Presentation maps (tone/label/icon) — Wave 3 tail

34 distinct maps: **25 already in `src/lib` SoTs** (keep) — `receiving/workflow-stages.ts`,
`condition-tone.ts`, `unit-status.ts`, `fba/status.ts`, `repair-status.ts`, `warranty/types.ts`,
`rma-status.ts`, `replenishment-status.ts`, shipping `normalize.ts` per-carrier maps, etc.
**9 component-inlined duplicates (fix — divergence risk):**

| Component | Problem |
|---|---|
| `FbaStatusBadge` | **redefines** `FbaStatus` enum + TOKENS (diverges from `lib/fba/status.ts`) |
| `ShipmentStatusBadge` | **redefines** `ShipmentStatusCategory` enum + `CATEGORY_STYLE` |
| `AuditEventCard` | `KIND_TONE` 20+ kinds hand-maintained; new kinds silently untoned |
| warehouse / work-orders / incoming-tiles | ad-hoc tone overlays |
| warranty tone-token→Tailwind bridge | two-step indirection |

Plus **~315 inline `'bg-x-50 text-x-700 ring-x-200'` literals** (~120 inline `Record` maps + ~170 ad-hoc) →
extract `lib/tone-primitives.ts` (`chipTone('amber')`, `badgeTone('emerald')`), eliminating ~40% duplication.

### 3.D — Reason / disposition vocabularies (Class D)

Operator-chosen "why" lists hardcoded as TS arrays/unions. **Already tenant-aware (keep — the target shape):**
the `reason_codes` table (`2026-05-14_reason_codes.sql`; `organization_id` via
`2026-05-23_org_id_on_business_tables.sql`; per-org unique `(organization_id, code)` via
`2026-06-16_reason_codes_per_org_unique.sql`; RLS FORCE staged in
`2026-06-16_enforce_tenant_isolation_reason_codes.sql.template`); CRUD in `src/lib/neon/reason-codes-queries.ts`;
`GET /api/reason-codes` resolver; pickers `ReasonCodePicker` + `admin/ReasonCodesManagementTab` (both org-scoped).

| Vocabulary | File:line | Home | Class-D kind | Migration |
|---|---|---|---|---|
| Substitution | `lib/fulfillment/substitution-reasons.ts:25` (7 codes + label/tone/hint, `isBuiltIn`, prettify) | lib (good shape) | **Descriptive** | D1 — seed as `flow_context='substitution'` rows; generic resolver replaces the array. **This file is the template.** |
| Short-pick | `lib/picking/sessions.ts:79` (union) + `components/mobile/picker/ShortPickSheet.tsx:30` (`REASON_OPTIONS` inlined) | lib + **component** | **Behavior-bearing** (backorder/short flow) | D2 — rows + decision rule on the code; de-inline the sheet |
| Receiving exception | `lib/receiving/exception-codes.ts:9` (`NO_PO/CARRIER_MISMATCH/SHORT/OVER/DAMAGED/WRONG_ITEM`, mirrors a DB CHECK) | lib | **Behavior-bearing** (exception lane + CHECK) | D2 — rows + decision rule; relax/relocate the CHECK |
| SKU-stock movement | `components/sku/sku-detail/sku-detail-types.ts:73` (`RECEIVED/SOLD/DAMAGED/ADJUSTMENT/RETURNED/CYCLE_COUNT`) | **component** | **Behavior-bearing** (→ `inventory_events` category) | D2 — overlaps the existing `reason_codes` categories; reconcile, don't re-invent |
| Repair / test-failure detail | `components/repair/ReasonSelector.tsx:18` (`REPAIR_REASONS`; already falls back to a dynamic `skuIssues` prop) | **component** | **Descriptive** | D1 — rows (`flow_context='repair_failure'`); the dynamic-prop path shows the seam is half-open already |
| Warranty denial | `reason_codes` (`category='warranty_denial'`) | **DB (done)** | Descriptive | — already migrated; the precedent |

The verdict→status map itself (`VERDICT_TO_STATUS`, `recordTestVerdict.ts:60`) is **Class A**, not D — D is the
granular *fail-reason detail*, A is the `verdict→status` write. They meet at the inspection/decision node.

> **STATUS (2026-06-28) — all vocabularies migrated.** `reason_codes` is now multi-vocabulary (a `flow_context`
> discriminator + composite unique `(organization_id, flow_context, code)`). Descriptive vocabularies
> (substitution, short-pick, repair-failure) are DB-backed + tenant-customizable via per-vocabulary registries
> (`*-reasons.ts`) + the shared `useReasonVocabulary` hook (degrade-to-built-ins). Behavior-bearing / system
> vocabularies (receiving-exception, sku-stock-adjust, the LLM disposition enum) are seeded for visibility with
> their registry kept as the engine's branch SoT. Read SoT = `getActiveReasonCodes` (the GET route delegates to
> it). The W0 guard (`reason-codes.guard.test.ts`) is live at **baseline 0** — no reason vocabulary inlines an
> array in a component.

---

## 4. Migration waves (sequenced, flag-gated, app-green)

Each wave is independently revertible and leaves the app green. Waves W1–W3 are the new Class-B/C work; they
slot into the master plan alongside §1.7 and Wave 3.

### W0 — Freeze the surface (prevent new hardcoding) · S
- Add a lint/guard rule (extend `scripts/` ratchet pattern) that **fails CI on a new literal status union,
  a new `current_status =` raw UPDATE, or a new inline `'bg-…ring-…'` triple** outside the registry files.
  Baseline the current count; baseline only shrinks (mirrors `ds-enforcement-guards`).
- **Also freeze Class D (LIVE — baseline 0):** `src/lib/reason-codes.guard.test.ts` fails CI on a **new hardcoded
  reason/disposition array** (`*_REASONS` / `REASON_OPTIONS` / `*_EXCEPTION_CODES` / `*_DISPOSITIONS`) outside the
  per-vocabulary registries (its `ALLOWED` set). Shrink-only; escape-comment `reason-codes-hardcoded`. Started at
  4, ratcheted to **0** as each vocabulary moved to a registry + `reason_codes`. In `test:ds-guards` + the CI glob.

### W1 — One carrier/status vocabulary SoT · S/M  *(Class B/C foundation)*
- Promote the carrier categories + `SHIPPED_BY_CARRIER_SQL` + `CUSTODY_CATEGORIES` into **one** module
  (`lib/shipping/lifecycle.ts`): the category enum, the "is-shipped"/"in-custody"/"terminal" predicates as
  **both** a TS function and a single exported SQL fragment. Re-point the 4 SQL copies + `outbound-state.ts`
  + `dashboard/operations` at it. Pure consolidation, no behavior change — parity-test the SQL.
- Promote the activity-type + station vocabulary into `lib/station-activity.ts` constants (already the type
  home) and re-point the raw `activity_type IN (...)` strings in orders/operations/staff-goals/kpi-table.

### W2 — The single order-lifecycle projection · M  *(kills the bug + the divergence)*
- Build `resolveOrderLifecycle(order): { stage, lane, tone, label }` in `lib/order-lifecycle.ts` — the **one**
  function that subsumes `deriveFulfillmentState` (`unshipped-state.ts`) **and** `deriveOutboundState`
  (`outbound-state.ts`) **and** the `has_tech_scan`/`is_shipped` booleans. Inputs are the canonical signals
  (tech-scan present, packed, staged, carrier custody, out_of_stock).
- Re-point every Class-B consumer (the §3.B table) at it: `UnshippedShelfBoard`, `UnshippedTable`,
  `DashboardShippedTable`, `shipped-details-logic`, the orders-route projection columns. Components stop
  deriving; they read `row.lifecycle`.
- The lane vocabulary + lane order + stall/SLA thresholds become a **config object** (seed from today's
  literals) so W4 can move it into Studio with no consumer change.
- **This is the first vertical slice — do it end-to-end on the testing/Unshipped board first** (§5).

### W3 — Tone/label registry convergence · M  *(Wave 3 tail)*
- Delete the 9 component-inlined enum/tone duplicates; import the lib SoT. Add a guard test (mirror the
  `sidebar-search-bar.guard.test.ts` pattern) that fails if `FbaStatus`/`ShipmentStatusCategory` are
  re-declared outside `lib/`.
- Extract `lib/tone-primitives.ts`; codemod the ~170 ad-hoc triples. `KIND_TONE` becomes a registry keyed by
  the engine event-kind enum (so a new kind is a compile error, not a silent gray dot).

### W4 — Lift the vocabulary into Studio (config, not literals) · M  *(Studio §2)*
- Move the W2 lane/threshold config + W1 carrier predicates into `workflow_nodes.config` /
  `workflow_definitions` (per-org, versioned, draft→publish). The projection function reads config instead of
  module constants. Now **a tenant edits lanes/stalls/rules in Studio**, not in code.
- Surface them as **decision-node rule tables** where routing is conditional (out-of-stock→BLOCKED,
  channel→FBA-vs-self-ship) — reusing the existing `decision` node + `decision-eval.ts` (already built).

### W5 — Enroll order/fulfillment into the engine graph (Option 1) · L/XL  *(master plan §1.7 + §1.7 enroll)*
- Author an `order_fulfillment` `workflow_definitions` graph; generalize `item_workflow_state` enrollment
  (the §1.7 non-serialized key) so orders enroll.
- Wire taps from the existing SAL writes (`TRACKING_SCANNED`→tested, `PACK_*`→packed, `SHIP_CONFIRM`→shipped)
  and carrier-status updates (→in-custody/delivered/exception). **Observe-only first** (log what the engine
  *would* set), reconcile against the W2 projection for a full cycle, then flip.
- `resolveOrderLifecycle` becomes a thin read of `item_workflow_state` — the projection and the engine agree
  because the engine *is* the source. The boards are now genuinely engine-driven.

### W6 — Class-A raw-bypass cleanup · S/M  *(master plan §1.3 residue)*
- Fold the named raw `current_status =` sites (§3.A) into `transition()`/`applyTransition`; keep the two
  deliberate guard-bypasses (force-pick, returns-undo) documented in `state-machine.ts`.

### Class-D waves (reason / disposition vocabulary) — parallel track

D-waves run **alongside** W0–W6, not after them: they share W0 (guard, extended above) and W4 (Studio config),
and reuse the `decision` node + `decision-eval.ts` from W4. Each is independently shippable. Start with the
descriptive vocabularies (D1) — they carry no status risk.

> **STATUS (2026-06-28): D1–D4 + the Class-A verdict config all SHIPPED.** Every §3.D vocabulary is migrated (W0
> guard at baseline 0); migrations `2026-06-28` / `…b`…`…f` applied + recorded. **D3/D4** — the `applies_to`
> column + `getActiveReasonCodes({ workflowNodeId })` resolver/route filter ("a node's palette = global reasons +
> reasons scoped to this node") + the manager-facing per-node palette editor in `ReasonCodesManagementTab` (PATCH
> `appliesTo`) — shipped + tested. **Class-A verdict config** — `VERDICT_TO_STATUS` is now per-org-overridable via
> `organizations.settings.workflow.verdictStatus`, behind `UNIFIED_ENGINE_VERDICT_CONFIG` (default OFF ⇒
> byte-identical; pure resolver `pickVerdictMapping` is unit-tested; fail-safes to the hardcoded map). **Optional
> remainder:** a palette editor *inside the Studio node inspector* (the admin-tab editor already covers the need);
> deeper per-data facts beyond `applies_to`.

#### D1 — Generalize `reason_codes` into the multi-vocabulary store · S/M  *(Class-D foundation)*
- Migration (`db-migration-author` skill): add `flow_context` (+ optional `applies_to`) to `reason_codes`; make
  `category` nullable / scoped to `flow_context='inventory_event'` so the existing CHECK keeps the ledger
  semantics intact. Idempotent, tenant-from-birth (the table is already org-scoped + RLS-staged).
- One resolver `getActiveReasonCodes(orgId, { flowContext, category?, workflowNodeId? })` (+ label/tone helpers)
  generalizing `substitutionReason*` — **does not exist today**; `GET /api/reason-codes` is the only reader now.
- Seed built-ins per org in `seedOrgCatalog` (`src/lib/neon/catalog-queries.ts:63`, `ON CONFLICT DO NOTHING`);
  cache per org with the 30s `resolveForOrg` pattern (`src/lib/feature-flags.ts`).
- **Migrate the descriptive vocabularies first** (substitution, repair-failure): array→rows, pickers→tenant
  rows, parity + cross-org isolation tests. `substitution-reasons.ts` becomes a thin built-in-seed + resolver
  shim (unknown codes still prettify). Lowest risk — nothing branches on these.

#### D2 — Behavior-bearing vocabularies → rows + decision rules · M  *(needs the W4 decision node)*
- For short-pick, receiving-exception, sku-stock movement: move the **vocabulary** to `reason_codes` rows **and**
  the **branch** to a `decision` node rule matching the code via the `disposition` fact
  (`decision-eval.ts` — `DecisionRule.when.disposition`). De-inline the 3 component arrays (§3.D).
- Where a DB CHECK enforces the set (receiving exceptions), either relax it to a small fixed **system** subset +
  free-form custom rows, or relocate enforcement to the resolver. Reconcile sku-stock reasons with the existing
  inventory-event `category` set — don't create a second vocabulary for the same ledger.
- Flag-gated, observe-first (log the rule's chosen port vs today's hardcoded branch for a cycle before flipping),
  mirroring the placement-strangle discipline (`PLACEMENT_PARITY_OBSERVE`).

#### D3 — Reasons selectable in Studio + per-node palettes · M  *(Studio §2, shared with W4)*
- The reason set a node offers becomes part of `workflow_nodes.config` (filter `reason_codes` by `flow_context`
  + `applies_to=node`), edited per-org draft→publish. The picker reads the placed node's config, so two tenants
  running the same template offer different reason palettes with zero code change.

#### D4 — Per-data reason / flow selection · M/L  *(the larger product piece)*
- Let item attributes (sku category, condition, source platform) narrow the reason palette and the decision
  branch: extend `gatherFacts` (`decision.node.ts`) beyond grade/channel/disposition so a rule (or the picker
  filter) can key off them. This is the "per data" customization — mostly **new rule authoring on the existing
  decision engine**, not new engine code.

---

## 5. First vertical slice — the testing/Unshipped board (the bug, end-to-end)

Do **one** board fully before generalizing, to prove the seam (mirrors the engine's strangler discipline):

1. **W1** carrier/activity SoT (small, mechanical).
2. **W2** `resolveOrderLifecycle` + re-point `UnshippedShelfBoard`/`UnshippedTable`/orders-route columns.
   The lane now comes from one function; `deriveFulfillmentState` becomes a thin alias slated for deletion.
3. **W4 (partial)** move *that board's* lane set + stall threshold into config so it's Studio-editable.
4. **W5 (observe-only)** add the `tested`/`packed`/`shipped` taps in log-only mode for orders; confirm the
   engine's projected lane matches `resolveOrderLifecycle` for a full cycle on the seeded `TEST-UNSHIP-*`
   orders. Then flip the board to read engine state.

Acceptance: scanning the seeded order's tracking at `/api/tech/scan` writes the TECH signal **once**, the
engine advances the order's node, and the board lane flips PENDING→TESTED with **no** component-side
derivation and **no** SQL `has_tech_scan` recompute. The three spines collapse to one.

---

## 6. Definition of done + guardrails

- **No literal status union** outside `lib/**` state/registry modules (W0 guard).
- **No raw `current_status =`** outside the two documented compensating sites (W0 guard + master plan §1.3).
- **No board/KPI re-derivation**: every lane/bucket comes from `resolveOrderLifecycle` (W2) or engine state
  (W5); `deriveFulfillmentState`/`deriveOutboundState`/`SHIPPED_BY_CARRIER_SQL` deleted or thin-aliased.
- **No inline tone/enum**: presentation reads a lib registry; redefining a status enum in a component fails a
  guard test (W3).
- **Vocabulary is config**: a new lane, stall threshold, or routing rule is a Studio edit (rows + draft→
  publish), not a code change (W4) — the master plan's headline "Definition of done".
- **One chokepoint, one event, coherent state**: every status change → `applyTransition` → one
  `inventory_events`/`workflow_runs` row; `serial_units.current_status` and `item_workflow_state` stay
  coherent (master plan §1.7).
- **No hardcoded reason array** outside `substitution-reasons.ts`-style built-in seeds + the resolver; every
  operator "why" picker reads tenant `reason_codes` rows (W0 + D1/D2 guard).
- **A new tenant reason code is end-to-end with no deploy**: created in Admin (`ReasonCodesManagementTab`), it
  appears in the relevant picker (filtered by `flow_context`) and — for a behavior-bearing code — is usable in a
  Studio decision rule that routes on it (D2–D4). Same headline "Definition of done", applied to vocabulary.

---

## 7. Cross-references

- Engine internals + node/tap registry: agent-mapped against `src/lib/workflow/` (registry, applyTransition,
  tap, decision-eval, placement, diagnostics, store) — 9 node types, 7 taps (2 firing), flags
  `UNIFIED_ENGINE_APPLY_TRANSITION` / `UNIFIED_ENGINE_FULFILLMENT_TAPS` ON, `DECISION_ENGINE_ZEN` OFF.
- Master plan phases this slots into: **§1.2/1.3** (Class A), **§1.7** (Class B re-point + order enrollment),
  **Wave 3** (Class C), **Studio §2** (W4 config surfaces).
- Studio build-order gates (skill `ops-studio`): vocabulary→config work is ST4/ST5 (editable graph + station
  editor); read-only projection (W2) ships before any editing unlocks — deliberate de-risking.
- Class-D (reason vocabulary) surfaces: table + migrations `2026-05-14_reason_codes.sql` /
  `2026-05-23_org_id_on_business_tables.sql` / `2026-06-16_reason_codes_per_org_unique.sql` /
  `2026-06-16_enforce_tenant_isolation_reason_codes.sql.template`; queries `src/lib/neon/reason-codes-queries.ts`;
  schema `src/lib/schemas/reason-codes.ts`; **template** `src/lib/fulfillment/substitution-reasons.ts`; pickers
  `ReasonCodePicker` / `admin/ReasonCodesManagementTab`; branch reuse `src/lib/workflow/decision-eval.ts`
  (`disposition` fact); seeding `seedOrgCatalog` (`catalog-queries.ts:63`); per-org cache `resolveForOrg`
  (`feature-flags.ts`).
```
