# DISCOVERY.md — Unified Workflow Engine (Phase 0)

**Status:** Phase 0 discovery complete. **No code changed.** This report is the gate; the
forward plan lives in [`docs/operations-studio/UNIFIED-ENGINE-MASTER-PLAN.md`](docs/operations-studio/UNIFIED-ENGINE-MASTER-PLAN.md).
Every data-model statement below is marked **Observed** (seen in a named file) or
**Assumption** (inferred, to confirm).

> Produced by a read-only multi-agent sweep (10 discovery agents + critic, 6 backlog-harvest
> agents) cross-checked by the orchestrator against the live migrations and `schema.ts`.

---

## 0. Headline — the brief's premise must be corrected before any code

The brief specifies building an **XState** lifecycle engine + **GoRules ZEN** routing layer on
**Supabase**, and assumes 4 new tables (`workflows, stations, states, transitions`). The repo
disagrees on every one of those points, and disagrees *because it already solved the problem a
different way*:

| Brief assumes | Repo reality (Observed) |
|---|---|
| Supabase | **Neon Postgres + Drizzle + postgres.js / neon-http** (`src/lib/db.ts`, `src/lib/drizzle/`) |
| XState already in use | **No `xstate` in `package.json`/`node_modules`.** A hand-rolled **node-graph engine** exists instead (`src/lib/workflow/`) |
| GoRules ZEN present | **No `@gorules/*`** anywhere. Branch logic lives inside each node's `port()` mapper |
| New `states`/`transitions` tables needed | **No such tables** (verified: `CREATE TABLE` grep over all 229 migrations returns zero). Routing is `workflow_edges`; state is `serial_units.current_status` |
| Cytoscape for viewing | **`@xyflow/react` (React Flow)** is the canvas lib |

**Decision (ratified direction): expand the existing node-graph engine; do _not_ introduce
XState or a parallel state machine.** Adopting XState would mean *replacing a live production
engine* — the exact "second parallel engine" the brief forbids. See the engine inventory (§2)
for why the node-graph model is the better long-term foundation for a durable, multi-tenant,
config-as-data SaaS workflow backend. The *decision/placement* layer is settled to **GoRules ZEN**
as the long-term target, adopted in stages behind a swappable `decision` node interface (master plan §1.6).

---

## 1. Actual data model (Observed)

### 1a. The engine graph (config-as-data) — already exists
Source: `src/lib/migrations/2026-06-03_workflow_graph_layer.sql`, `…2026-06-11d…`,
`…2026-06-12…`; mirrored in `src/lib/drizzle/schema.ts:2779–2900`.

| Table | Role | Brief concept it fills |
|---|---|---|
| `workflow_definitions` | Versioned named graph per org; `is_active` flip publishes a new version, in-flight items finish on their old one | **workflows** |
| `workflow_nodes` | Canvas node; `type` = engine registry key; `config` jsonb (`states`, `station`, `slaHours`, `channel`, `producesConditionGrade`); React-Flow `position_x/y` | **workflows / states** |
| `workflow_edges` | `(source_node, source_port) → target_node` — the conditional-routing key. Unrouted port = terminal; reserved `error` port parks for triage | **transitions** |
| `item_workflow_state` | A serial unit's current **position** (`current_node_id` + `status active\|blocked\|done\|error` + `context` jsonb). One active row per unit (`ux_item_workflow_state_unit`) | **states (pointer)** |
| `workflow_runs` | Append-only node-execution log (output port, `duration_ms`, error) | **audit** |
| `workflow_node_stats` | Daily per-(definition,node) queue-depth/blocked/error snapshots (cron-written) | **audit / analytics** |
| `station_definitions` | `(org, page_key, mode_key)` station composition (slots→blocks→bindings); **`workflow_node_id` links a station to a graph node**; versioned/`is_active` like definitions | **stations** |

**The seeded, published, live graph** (`2026-06-11b_seed_reseller_workflow_v1.sql`, org #1
`Standard refurb-and-list` v1, `is_active=true`):

```
receive ──received──▶ test-grade ──pass──▶ list_ebay ──listed──▶ pack ──packed──▶ ship
                          │  ▲
                       fail  └──repaired── repair
```
The brief's repair loop **already exists** here (`test-grade --fail--> repair --repaired--> test-grade`).

### 1b. The aggregate root + placement
- **`serial_units`** (`2026-04-10_create_serial_units.sql` + inventory_v2 migrations;
  `schema.ts:2073`) — canonical per-unit lifecycle status + placement. `current_status` is
  `serial_status_enum`; the engine *pointers into* this, it does not own it.
- **`serial_status_enum` = 22 values** *(Observed, definitively counted across the 3 migrations)*:
  base 9 (`UNKNOWN, RECEIVED, TESTED, STOCKED, PICKED, SHIPPED, RETURNED, RMA, SCRAPPED`)
  + 10 (`TRIAGED, IN_REPAIR, REPAIR_DONE, IN_TEST, GRADED, ALLOCATED, PACKED, LABELED, STAGED, ON_HOLD`)
  + 3 (`PICKING, PACKING, LOADING`).
- **Placement is rich and Observed:** `locations` (zone/room/row/col/`bin_role`/parent), `bin_contents`
  (sku→bin qty), `handling_units` (LPN boxes, `OPEN/STAGED/IN_TEST/CLOSED`), `inventory_events.bin_id/prev_bin_id`,
  `location_transfers`, `replenishment_tasks`. **Two parallel placement reps:** free-text
  `serial_units.current_location` **vs** FK `bin_id` (on `inventory_events`/`handling_units`) — a
  consolidation target.

### 1c. Audit/event spines (numerous, NOT unified)
`audit_logs` (generic polymorphic), `inventory_events` (the closest thing to a unified unit/line
spine), `station_activity_logs` (scan log), `workflow_runs` (node exec), `warranty_claim_events`,
`serial_unit_condition_history`, `mobile_scan_events`, `cron_runs`, `fba_scan_events`,
`repair_actions`, `location_transfers`, `repair_service.status_history` (jsonb in-row).

### Gaps vs the brief (Observed)
- **No `states` table, no `transitions` table** — by design; the graph + the enum cover them.
- **No ZEN / decision-table storage** anywhere.
- **`item_workflow_state.serial_unit_id` is NOT NULL + unique-per-unit** → only serialized units can
  enroll; non-serialized inventory cannot today.

---

## 2. Existing engine inventory

**Location:** `src/lib/workflow/` — `index.ts` (public API), `contract.ts` (types + `WorkflowStore`
boundary), `advance.ts` (`advanceItem` chokepoint), `router.ts` (`selectNextTarget`, pure edge
routing), `runtime.ts` (`runNode`, error-port mapping), `store.ts` (Drizzle store, passes
`organizationId` explicitly because neon-http can't see the `app.current_org` GUC), `registry.ts`
(node registry), `events.ts`, `diagnostics.ts` (`runDiagnostics`), `node-stats.ts`, `tap.ts`
(`tapWorkflow`), `nodes/*` (receiving, inspection, repair, list_ebay, pack, ship, station-node).

**What's already built that the brief asks to "build":**
- **Single chokepoint** `advanceItem()` (`advance.ts:51`): `lock → loadState → runNode → recordRun → emit → (await?park : error?park : resolveNext?moveTo : done)`.
- **Pure data routing** (`router.ts:26`): conditional branching is **edges, not code**. First-match wins (no ambiguity guard).
- **Thin-adapter law** enforced by `stationNode()` (`nodes/station-node.ts:51`): nodes do only event→port mapping, no domain work.
- **Save-time validation** `runDiagnostics` (`diagnostics.ts:104`): unreachable-node, dead-end-port, terminal, no-station, station-unmapped-role/action. **Publish is diagnostics-gated** (422 `PUBLISH_BLOCKED`, `publish/route.ts:88`).
- **Versioning + in-flight semantics**: `workflow_definitions.version` + `is_active` flip in one tx; `item_workflow_state` pins the definition id.
- **Observability**: `workflow_runs` + `workflow_node_stats` + `GET /api/studio/live`.

**LIVENESS (verified — corrects an earlier mischaracterization):** the engine is **LIVE on the
intake half**, not dormant. Exactly **4** production `tapWorkflow()` producers (fire-and-forget
after the domain commit; `tap.ts` never throws):
- `src/app/api/receiving/scan-serial/route.ts:236` — `unit_received`
- `src/app/api/receiving/mark-received-po/route.ts:622` — batch `unit_received`
- `src/lib/tech/recordTestVerdict.ts:256` — `test_verdict` (pass/fail fork)
- `src/lib/neon/repairs-queries.ts:380` — `repair_completed` (closes the re-test loop)

So units flow `receive → test → (repair loop) → test → list_ebay` **today**, then **pool at
`list_ebay`**: the `list_ebay`/`pack`/`ship` node adapters exist and edges route to them, but **no
tap fires `listed`/`packed`/`shipped`**. `pack/ship/route.ts` has **zero** workflow import
(verified) — it does `UPDATE orders SET status='shipped'` at line 337 with no engine involvement.

**Stubs / unfinished (Observed):**
- `NULL_LOCK` (`contract.ts:146`) — production `advanceItem` runs with a **no-op lock**; the real
  per-unit lock ("Phase D") is unbuilt. Double-scan races on one unit are unguarded (mitigated
  only by idempotent event-gated parking).
- **No unpark/recovery path** — nothing resets a `blocked`/`error` `item_workflow_state` back to
  `active`. Items that error have no UI to recover.

**Why node-graph beats XState long-term (the design rationale):** XState is an in-memory FSM
library; this is a *durable* orchestrator where state lives in Postgres and advances across
separate HTTP requests/scans/webhooks over days. Rehydrate-and-advance collapses XState to a
table lookup the router already does — while its differentiating features (statecharts, parallel
regions, actors) go unused. Config-as-data + per-org versioning + an embeddable React-Flow editor
are exactly the SaaS requirements, and they already exist. XState's legitimate home here is
*local component state* (e.g. `src/lib/packer/pack-scan-machine.ts`), not the backend engine.

---

## 3. State / station reconciliation vs the brief's §1.1

**There is NO single unified lifecycle status — there are ~12 independent representations.** This
fragmentation (not a missing engine) is the core problem to unify:

1. `serial_units.current_status` (`serial_status_enum`, 22 values) — canonical; guarded by `src/lib/inventory/state-machine.ts:23–86`.
2. `receiving_lines.workflow_status` (`inbound_workflow_status_enum`: `EXPECTED, ARRIVED, MATCHED, UNBOXED, AWAITING_TEST, IN_TEST, PASSED, FAILED, RTV, SCRAP, DONE`) — code SoT `src/lib/receiving/workflow-stages.ts`.
3. `receiving(_lines).qa_status` (`qa_status_enum`) — a third pass/fail axis.
4. `receiving_lines.disposition_code` (`disposition_enum: ACCEPT, HOLD, RTV, SCRAP, REWORK`).
5. `item_workflow_state.current_node_id` — the engine's position pointer (de-facto parallel index).
6. `fba_shipments(_items).status` (`fba_shipment_status_enum`; code redefines it in `src/lib/fba/status.ts`).
7. `warranty_claims.status` (`src/lib/warranty/transitions.ts`).
8. `rma_authorizations.status` (`rma_status_enum`).
9. `repair_service.status` — **free text, no CHECK/enum** (history in `status_history` jsonb).
10. `work_assignments.status` (`assignment_status_enum`).
11. Derived order/package states (not stored): `src/lib/outbound-state.ts`, `src/lib/unshipped-state.ts`.
12. `sales_orders.status` (free text, written by `src/services/OrderSyncService.ts` from Zoho).
    Plus UI tone map `src/lib/unit-status.ts` re-listing the vocabulary, and `src/features/operations/` re-deriving pipeline buckets.

**Brief §1.1 → repo mapping (key divergences flagged):**

| Brief code | Match | Repo reality |
|---|---|---|
| `RECEIVED` | exact | `serial_units='RECEIVED'`; receiving lifecycle spans `EXPECTED→UNBOXED` separately |
| `TESTING_QC` | **partial** | splits into `AWAITING_TEST` + `IN_TEST`; no state literally named `TESTING_QC` |
| `IN_REPAIR` | exact | `serial_units='IN_REPAIR'`; but inbound enum has no in-repair state |
| `GRADED` | **partial** | enum value exists, **but `recordTestVerdict` PASS writes `TESTED`, not `GRADED`**; condition grade is a *separate axis* (`condition_grade_enum`) |
| `LISTED` | **partial** | **not a `serial_status` value** — lives only in the node graph + listing tables |
| `PACKING` | exact | expands into `PICKING/PACKED/LABELED/STAGED/LOADING`; FBA has its own `PACKED` |
| `SHIPPED` | exact | + post-ship custody modeled separately as derived `OutboundState` |
| `ON_HOLD` | exact | universal-entry; `TESTING_FAILED` verdict also routes here (`recordTestVerdict.ts:44`) — **not `IN_REPAIR`** |
| `SCRAPPED` | exact | + inbound enum spells it `SCRAP` (two spellings) |

**Stations have 3 distinct meanings:** (a) `station_definitions` (page/mode composition data),
(b) seed graph `config.station` keys (`RECEIVING/TECH/PACK/ADMIN`), (c) runtime `staff_stations`
enum (`TECH/PACK/UNBOX/SALES/FBA`). These sets do not match — a reconciliation item.

---

## 4. Smell catalog (Observed; counts are agent-reported, hotspots verified)

| Smell | Count | Top hotspots | How the unified engine subsumes it |
|---|---|---|---|
| **Shotgun surgery** — per-action handler repeating load→check→set→log | ~26 handlers | `receiving/lines/[id]/status/route.ts`, `recordTestVerdict.ts`, `serial-units/[id]/test/route.ts`, `pack/ship/route.ts`, `warranty/mutations.ts`, `inventory/returns.ts` | One `applyTransition(unitId, event, input)` helper (guard → write `serial_units` → `recordInventoryEvent` → `tapWorkflow`); domain handlers become pure decision fns |
| **Primitive obsession** — status string literals branched everywhere | **315** | `state-machine.ts`, `workflow-stages.ts`, `repair-service-queries.ts`, `unit-status.ts`, `fba/status.ts` | One state registry + typed codes; never compare raw strings |
| **Ordinal arithmetic** | **0 real** | (centralized `order` field in `workflow-stages.ts` is fine, not a smell) | n/a — already declarative |
| **UI deciding transitions** | **6** | `src/components/repair`, QC, sourcing, po-gmail | Components emit `transition('pass_qc')`, never POST a hardcoded status |
| **Inline role gates** | **12** | `orders/[id]`, `admin/staff/[id]/permissions`, `admin/roles/[id]`, `useStaffRole.ts` | Engine resolves effective permissions at advance time; consolidate UI checks to one helper |
| **Hardcoded placement/table routing** | **22** | `serial-units/[id]/grade`, `inventory/parts-sort.ts`, `amazon/order-sync.ts`, `receive-line.ts`, `inspection.node.ts` | A decision node (grade/channel/disposition) outputs `{placement, target_table}`; logic moves to graph/decision config |
| **Near-duplicate per-station panels** | 25+ | `src/components/sidebar`, `fba/sidebar`, `shipped`, `station` | One config-driven `StationPanel` over `station_definitions.config` + a block registry |

---

## 5. Routing / placement inventory (what a decision layer will own)
22 hardcoded sites pick a bin/lane/queue or a target table by **grade / channel / disposition /
type**. Representative: grade→staging (`parts-sort.ts`), channel FBA vs self-ship
(`amazon/order-sync.ts`, FBA libs), disposition `ACCEPT/HOLD/RTV/SCRAP/REWORK`
(`receive-line.ts`). These become declarative decision-node outputs `{placement, category,
target_table?, target_queue?}` consumed by the engine's action layer.

---

## 6. Risk register (Observed, critic-verified)

| Rank | Site | Why risky |
|---|---|---|
| 🔴 **Highest blast radius** | `pack/ship/route.ts:337` (`UPDATE orders SET status='shipped'`) + `:204` (`order_unit_allocations`) + `:306` packer_logs | The **irreversible carrier-custody seam**, and the one the engine does NOT observe. Strangle **last**, observe-only first |
| 🔴 Inventory-truth leak | ~20 ungated raw `current_status =` UPDATEs (`rma/authorizations.ts`, `serial-units-queries.ts`, `parts-sort.ts`, `hold.ts`, `returns.ts`, pick/scan, fba ship-units, orders allocate/release, putaway) | Bypass the guarded `transition()`; touch allocation/holds/returns (money-adjacent) |
| 🟠 Birth points | `src/services/OrderSyncService.ts` / `InventorySyncService.ts` | Create orders/items. *Verified:* they write `sales_orders`/`items` status, **not** `serial_units` — so not a unit-enrollment seam, but a separate order-status axis |
| 🟠 Dual-spine landmine | `receiving/lines/[id]/status/route.ts:129–153` | Writes BOTH `receiving_lines.workflow_status` AND `serial_units`, bypassing both `transition()` and `tapWorkflow` — clearest drift example |
| 🟢 Safest reference | `recordTestVerdict.ts:256` | Already taps the engine + writes status; ideal first strangle target |
| 🟠 Context-free writers | crons (tracking DELIVERED, warranty clock, node-stats) | Hardest to route through a request-shaped engine |

---

## 7. Proposed phase order (the strangler-fig sequence)

> Full detail, with the broader codebase backlog and cleanup waves, in
> [`UNIFIED-ENGINE-MASTER-PLAN.md`](docs/operations-studio/UNIFIED-ENGINE-MASTER-PLAN.md).

0. **CROSS-CUTTING, before Phase 1 hits prod:** replace `NULL_LOCK` with a real per-`serial_unit`
   lock; add an unpark/recovery path for `blocked`/`error` items.
1. **Reference impl:** route `recordTestVerdict` through one `applyTransition(event)` helper (live, idempotent, reversible).
2. **Kill the dual spine:** fold `receiving/lines/[id]/status` + the two receiving producers into the same helper.
3. **One guarded writer:** migrate the ~20 raw `current_status =` UPDATEs through `transition()` (hold/allocate/release/returns first).
4. **Wire the dormant tail from the safe side:** `list_ebay 'listed'` → `pack 'packed'` (reversible).
5. **Last, behind a hard flag + observe-only first:** `ship 'shipped'`.

---

## 8. Decisions (resolved 2026-06-21)

1. **Engine strategy — RESOLVED:** expand the node-graph engine; **no XState**.
2. **Decision/placement layer — RESOLVED:** **GoRules ZEN is the long-term target** (operator-editable
   JDM decision tables + `@gorules/jdm-editor`, the SaaS requirement). Adopt in stages behind a
   swappable `decision` node interface — minimal in-house evaluator first (unblocks the engine
   cutover), swap to ZEN later. Prefer the **WASM build (`@gorules/zen-engine-wasm`)** for Vercel
   serverless portability; one spike to confirm runtime fit before committing.
3. **Branch protocol — RESOLVED:** **work on `main`** (standing project rule wins over the brief's
   `refactor/unified-engine`). Strangler safety comes from per-call-site feature flags, not branches.
4. **Stack mismatches** in the brief (Supabase/XState/GoRules/Cytoscape/4-tables) are all inaccurate
   vs the repo — the plan is written to the *real* stack.
