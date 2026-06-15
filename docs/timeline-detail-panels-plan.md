# Detail-Panel Timelines — SAL org_id finish + audit_logs/inventory_events spines

**Goal:** Show an event-trail timeline in the detail panels for **(1) Shipped orders**,
**(2) Incoming / receiving-line rows**, and **(3) all Tech display**, using the shared
`EventTimeline` primitive. Sequenced as the user asked: **finish `org_id` on SAL first**,
then **build out the `audit_logs` (+ `inventory_events`) timeline reads**.

**Date:** 2026-06-14
**Status:** ✅ ALL PHASES IMPLEMENTED 2026-06-14 (tsc + build clean). See implementation log at bottom.

---

## What already exists (verified, do not rebuild)

- **Shared timeline UI** — `src/components/ui/EventTimeline.tsx` (generic, day-banded,
  tone registry SoT). Renders `TimelineItem[]` from `src/lib/timeline/types.ts`.
- **Adapter pattern** — `src/lib/timeline/{carrier-events,order-events}.ts` map a domain
  source → `TimelineItem[]`. Panels never hand-roll a timeline; they call an adapter.
- **Shipped panel already has a timeline** — `OrderTimelineSection`
  (`src/components/shipped/OrderTimelineSection.tsx`) → `GET /api/orders/[id]/timeline`
  → reads `audit_logs WHERE lower(entity_type)='order' AND entity_id=$1` →
  `orderAuditToTimeline`. Wired at `ShippedDetailsPanel.tsx:518`.
- **Incoming panel already renders `EventTimeline`** for **carrier events only**
  (`IncomingDetailsPanel.tsx:610`, `carrierEventsToTimeline(s.events)`).
- **Tech already has a unified event view** — `audit-trail-anchor-plan.md` Phase 1
  (2026-06-04) made `getTechSessionDetail` read the `inventory_events` spine
  (`RECEIVED / TEST_START / TEST_PASS / TEST_FAIL / PUTAWAY …`) anchored on
  **`receiving_lines.id` under the PO** ("line under PO"), rendered by the bespoke
  `AuditLogTechClient.tsx` (NOT the shared `EventTimeline`).
- **Two event spines, decided anchors:**
  - `audit_logs` — **order-anchored** business events (label, tracking, pack, ship).
    Has `organization_id` (nullable; stamped from actor's org).
  - `inventory_events` — **receiving-line / unit-anchored** lifecycle events
    (incl. the tech verdict `TEST_PASS/FAIL`). Org inferred via `serial_units`.
- **SAL `organization_id` is ALREADY in the DB** — `2026-05-23_org_id_on_business_tables.sql`
  added it `NOT NULL`, FK→`organizations`, indexed, RLS-armed, default = tenant GUC.
  `createStationActivityLog` already requires & inserts it.
- **Tech verdict audit actions already defined** — `audit-logs.ts:140-142`
  `TECH_QC_PASS='tech.qc.pass'`, `TECH_QC_RETEST='tech.qc.retest'`, `TECH_QC_FAIL='tech.qc.fail'`.
  **They are defined but never emitted** by `recordTestVerdict`.

---

## Phase 0 — Finish `org_id` on SAL (small; DB already done)

The column exists in Postgres; the gap is ORM reflection + any raw-SQL insert sites that
bypass the helper.

**0.1 — Reflect the column in Drizzle.**
`src/lib/drizzle/schema.ts` `stationActivityLogs` pgTable (≈ line 913) omits
`organizationId`. Add it so typed queries can select/filter it:
```ts
export const stationActivityLogs = pgTable('station_activity_logs', {
  id: serial('id').primaryKey(),
  organizationId: orgIdCol(),           // ← add (DB column already exists)
  station: varchar('station', { length: 20 }).notNull(),
  ...
});
```
No migration. Pure type-sync.

**0.2 — Audit raw INSERTs into `station_activity_logs` that bypass the helper.**
Any `INSERT INTO station_activity_logs (...)` that does NOT list `organization_id` will
hit the `NOT NULL` (no GUC) or silently land under the wrong org (with GUC). Sweep:
```
grep -rn "INSERT INTO station_activity_logs" src
```
For each: confirm it either (a) goes through `createStationActivityLog`, or (b) runs under
`withTenantConnection` (GUC default stamps it), or (c) explicitly passes `organization_id`.
Fix any that don't. (Migration backfill scripts under `src/lib/migrations/` are exempt.)

**0.3 — Verify.** `tsc --noEmit` clean; spot-run a SAL-reading query
(`/api/activity/feed`) to confirm no regression.

**Exit criteria:** schema reflects `organizationId`; every live SAL insert is org-stamped.

---

## Phase 1 — `audit_logs` spine completeness (the real timeline gap)

The order-anchored spine is missing the **tech verdict** milestone. Close it so the
Shipped timeline can show *label → tech verdict → packed → scanned-out*.

**Design decision:** the verdict happens on a **unit at receiving**, often *before* the
unit is allocated to an order. So we do NOT try to write an order-anchored audit row at
test time (the order link usually doesn't exist yet). Two complementary moves:

**1A — Emit the canonical verdict audit row at its natural anchor.**
In `src/lib/tech/recordTestVerdict.ts`, after the `inventory_events` insert, emit an
`audit_logs` row via `recordAudit` using the already-defined actions:
- `TECH_QC_PASS` / `TECH_QC_RETEST` / `TECH_QC_FAIL`
- `entity_type` = `RECEIVING_LINE` (the decided "line under PO" anchor), `entity_id = lineId`
- `metadata`: `{ serialUnitId, verdict, inventoryEventId, sku }`
- org: inherited from `serial_units.organization_id` (pass explicitly; this path may not
  run under `withTenantConnection`).
This makes the verdict a first-class, org-scoped, queryable audit event — feeding the
**Tech** and **Incoming** timelines directly (both anchor on `receiving_line_id`).

**1B — Read-time merge for the order (Shipped) timeline.**
`audit_logs` for an order won't carry the verdict (wrong anchor). So extend
`GET /api/orders/[id]/timeline` to *also* resolve the order's allocated units and merge
their verdict events:
```
order.id → order_unit_allocations.serial_unit_id
        → serial_units.origin_receiving_line_id (lineIds) + unit ids
        → inventory_events WHERE event_type IN ('TEST_PASS','TEST_FAIL','TEST_START')
             AND (serial_unit_id = ANY(unitIds) OR receiving_line_id = ANY(lineIds))
```
Map those into the same `events` array the route returns; `orderAuditToTimeline` gains
`TEST_PASS/TEST_FAIL/TEST_START` → titles/tones. Read-only; no new writes on the order.
(If `order_unit_allocations` is sparse, the verdict simply doesn't show for that order —
acceptable degradation, logged, not fatal.)

**Verify:** unit-test `orderAuditToTimeline` with the new actions; live-check an order that
has a tested unit shows the verdict row.

---

## Phase 2 — Wire the three detail-panel timelines

All three follow the proven triplet: **adapter (`src/lib/timeline/*`) + section component +
read route**, rendered through the shared `EventTimeline`.

### 2A — Shipped (enhance existing)
- Already mounted. After Phase 1B the verdict appears automatically.
- Add `TEST_*` tones/titles to `orderAuditToTimeline` (`src/lib/timeline/order-events.ts`).
- No new component.

### 2B — Incoming / receiving-line (new)
- **Adapter:** `src/lib/timeline/receiving-line-events.ts` →
  `receivingLineEventsToTimeline(rows)` mapping `inventory_events` event types
  (`RECEIVED / TEST_START / TEST_PASS / TEST_FAIL / PUTAWAY / MOVED / GRADED / LABELED …`)
  → `TimelineItem[]` with tones mirroring the receiving palette already used in
  `AuditLogTechClient`.
- **Route:** `GET /api/receiving/[lineId]/timeline` (or batch by PO →
  `receiving_line_id = ANY(lineIds)`), reading `inventory_events` + the verdict
  `audit_logs` rows from Phase 1A, newest-first, org-scoped. Gated by `receiving.view`.
- **Component:** `ReceivingLineTimelineSection` (clone `OrderTimelineSection`), mounted in
  `IncomingDetailsPanel.tsx` **below** the existing carrier `EventTimeline` (keep carrier
  events separate; this is the internal-handling trail). For a PO row, fan out over its
  `receiving_line_id`s.

### 2C — Tech display (adopt the shared primitive)
- The data already exists (tech-aggregator `inventory_events` spine). Goal here is
  **presentation consistency**: render the tech detail trail through the shared
  `EventTimeline` instead of the bespoke `AuditLogTechClient` list.
- **Adapter:** `src/lib/timeline/tech-events.ts` → `techEventsToTimeline(rows)` covering
  the tech source union (`inventory_event` + `tech_serial_numbers` scan rows +
  `testing_results`), de-duped per the existing `audit-trail-anchor` rule (suppress
  synthetic `SERIAL_TESTED` when a first-class `TEST_*` exists).
- **Mount:** add an `EventTimeline` section to the Tech detail panel fed by
  `techEventsToTimeline(getTechSessionDetail(...).events)`. Keep `AuditLogTechClient` until
  parity is visually confirmed, then switch it over (low-risk, additive first).

---

## Sequencing & checkpoints

1. **Phase 0** (schema reflect + insert audit) — independent, ship first. `tsc` gate.
2. **Phase 1A** (emit `tech.qc.*` audit row) — unblocks 2B/2C verdict rows.
3. **Phase 1B + 2A** (order timeline merge) — Shipped shows the verdict.
4. **Phase 2B** (Incoming receiving-line timeline) — new route + adapter + section.
5. **Phase 2C** (Tech shared-primitive adoption) — additive, then swap.

Each phase: `tsc --noEmit` + `npm run build` gate; new API route → run through the
`api-route-reviewer` (auth guard + Zod + audit emit) and `neon-cost-reviewer` (no N+1 /
read-time fan-out regressions); permission-registry change (if any new route perm) →
`permission-registry-guard`.

## Cross-cutting notes
- **Tenancy:** every new read route filters by `organization_id` (now present on SAL too);
  prefer `withTenantConnection` so the GUC/RLS does the scoping.
- **No new spine:** reuse `audit_logs` (order) + `inventory_events` (line/unit). SAL stays
  the scan/operational ledger + realtime feed; it is not a timeline backbone.
- **Anchor consistency:** receiving-line / tech timelines anchor on `receiving_line_id`
  ("line under PO"), matching the 2026-06-04 decision.

---

## Implementation log (2026-06-14)

**Surprise corrections vs. the original analysis:**
- **SAL already had `organization_id`** (NOT NULL, FK, indexed, RLS-armed) from
  `2026-05-23_org_id_on_business_tables.sql`; only the Drizzle reflection was missing.
- **The tech verdict was already a first-class audit row** — `serial-units/[id]/test/route.ts`
  already emits `tech.qc.*` (org-scoped, `entity_type=serial_unit`) AND `inventory_events`
  TEST_*. So Phase 1A required **no new write** — all real work was read-side.

**Phase 0 — SAL org_id finish.**
- `schema.ts` `stationActivityLogs`: added `organizationId: orgIdCol()`.
- Stamped `organization_id` on the two raw inserts that bypass `createStationActivityLog`:
  `src/app/api/pack/ship/route.ts` (PACK_SHIPPED) and
  `src/app/api/post-multi-sn/route.ts` (LABEL_PRINTED) — both now pass `ctx.organizationId`
  (previously relied on a GUC default that is NULL on non-tenant connections → latent
  NOT NULL / silently-swallowed insert).

**Phase 2-shared — adapters.** `src/lib/timeline/`:
- `inventory-events.ts` → `inventoryEventsToTimeline(InventoryTimelineRow[])`.
- `tech-events.ts` → `techEventsToTimeline(TechTimelineRow[])` (decoupled input types; client-safe).
- Both exported from `timeline/index.ts`.

**Phase 1B + 2A — Shipped.** `GET /api/orders/[id]/timeline` now returns `{ events, lifecycle }`:
resolves the order's `order_unit_allocations` → `readInventorySpine({ serialUnitIds, eventTypes:
TEST_* })`. `OrderTimelineSection` merges both spines, re-sorted newest-first. Shipped panel
already mounted it — verdict now shows.

**Phase 2B — Incoming.** `incoming/details` route swapped carton-only `readTimeline` for
`readInventorySpine({ lineIds, cartonIds })` ("line under PO") and enriched `receive_events`
(actor_name/serial_number/prev_status/next_status). New **Activity** tab in
`IncomingDetailsPanel` renders `inventoryEventsToTimeline(receive_events)`.

**Phase 2C — Tech.** `AuditLogTechClient` now renders the shared `EventTimeline` via
`techEventsToTimeline(detail.events)` above the existing detail cards.

**Security fix (api-route-reviewer).** `GET /api/orders/[id]/timeline` keyed only on the order
id → cross-tenant read risk. Added an **org ownership pre-flight** (fetch `orders.organization_id`,
404 on mismatch) before the trail queries. Used the sibling tracking route as the model.

**Cost (neon-cost-reviewer).** Confirmed O(1) queries per panel-open (batched ANY(array), no
N+1). Added `LIMIT` caps to the two unbounded reads (allocations, receiving_lines). Indexes for
all access paths already exist (`idx_ie_*_time`, `idx_oua_order_state`). Future note: the
3-column OR in `readInventorySpine` resists combined indexing — callers should not pass all three
id sets with large arrays simultaneously (current callers pass ≤2).

**Gates:** `tsc --noEmit` clean; `npm run build` clean.
