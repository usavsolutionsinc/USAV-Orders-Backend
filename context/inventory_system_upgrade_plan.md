# Inventory System Upgrade Plan
## State-Machine Inventory, GS1 QR, Per-Unit Tracking — Grounded in the Actual Codebase

**Status:** v2 (rewrite grounded in code scan)
**Last revised:** 2026-05-17
**Scope:** Wire the inventory tables that already exist (`serial_units`, `inventory_events`, `sku_stock_ledger`, `locations`, `sku_catalog`) into a single coherent state machine across receiving → tech → pack → ship → return, replace the implicit decrement model, add GS1 Digital Link QR scanning, and reconcile the legacy `tech_serial_numbers` model with the new per-unit `serial_units` model.

This plan replaces v1. v1 was a greenfield design that ignored ~30 migrations of inventory infrastructure already shipped between 2026-04-09 and 2026-05-15. v2 takes that infrastructure as the starting point and focuses on **what is not yet wired up** and **what needs to change in the application layer** to make it the single source of truth.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State — What Exists Today](#2-current-state--what-exists-today)
3. [Gap Analysis — Where the System Is Broken](#3-gap-analysis--where-the-system-is-broken)
4. [Target Architecture](#4-target-architecture)
5. [Schema Decisions and Reconciliation](#5-schema-decisions-and-reconciliation)
6. [Workflow Wire-Up](#6-workflow-wire-up)
7. [Scan and Label System (GS1 Digital Link)](#7-scan-and-label-system-gs1-digital-link)
8. [Event and Audit Model](#8-event-and-audit-model)
9. [Migration and Backfill Strategy](#9-migration-and-backfill-strategy)
10. [Phased Rollout](#10-phased-rollout)
11. [Cross-Cutting Code Cleanup](#11-cross-cutting-code-cleanup)
12. [Open Decisions](#12-open-decisions)
13. [Success Metrics](#13-success-metrics)

---

## 1. Executive Summary

The codebase already contains most of the building blocks for the inventory model described in v1. Between 2026-04-09 and 2026-05-15 the team shipped:

- `serial_units` — per-unit aggregate root with state enum (UNKNOWN | RECEIVED | TESTED | STOCKED | PICKED | SHIPPED | RETURNED | RMA | SCRAPPED)
- `sku_stock_ledger` — append-only signed-delta ledger, marked authoritative on 2026-04-15
- `inventory_events` — unified lifecycle event log with idempotency (`client_event_id`) and last-touch views
- `locations` (bin-addressable, multi-warehouse), `sku_catalog` (with GTIN, post 2026-05-14), `printer_profiles`, `reason_codes`, `cycle_counts`, `stock_alerts`, `photos.bin_adjustment`

What is **not** done:

- **The packer/ship path does not emit `inventory_events` of type SHIPPED, does not touch `serial_units.current_status`, and does not decrement stock.** It only sets `orders.status='shipped'` and writes a `packer_logs` row. Decrement happens implicitly via Zoho sync or manual bin operations.
- **`serial_units` is only populated by `receiving/mark-received`.** Tech scans still go to the legacy `tech_serial_numbers` table; the two are not joined.
- **The scan resolver has no GS1 Digital Link support.** It handles TRACKING/FNSKU/SKU/REPAIR text patterns only.
- **The Drizzle ORM schema (`src/lib/drizzle/schema.ts`) does not know about `serial_units`, `inventory_events`, or `sku_stock_ledger`.** They are accessed via raw SQL only, which means there are no typed types, no migrations through `drizzle-kit`, and easy drift.
- **Order allocation does not exist.** There is no ALLOCATED state, no allocation-to-pick handoff, no per-order serial reservation. Stock is "available" until it ships, which is the double-counting problem.
- **FBA pack/verify is aggregate-only.** `fba_shipment_items.actual_qty` tracks counts, not specific serials.

The upgrade is therefore **mostly an integration project**, not a greenfield build. The data model is ~70% in place; the application code is ~25% wired to it. v2 focuses on closing that gap.

---

## 2. Current State — What Exists Today

### 2.1 Inventory tables (in raw migrations, NOT in Drizzle schema)

| Table | Migration | Purpose | Status |
|---|---|---|---|
| `serial_units` | `2026-04-10_create_serial_units.sql` | Per-unit identity, state, location, condition | Populated only by `mark-received`; FK column added 2026-04-11 |
| `sku_stock_ledger` | `2026-04-09_create_sku_stock_ledger.sql` | Signed-delta audit (RECEIVED/SOLD/DAMAGED/ADJUSTMENT/RETURNED/SET/CYCLE_COUNT) | Authoritative since `2026-04-15_sku_stock_ledger_authoritative.sql` |
| `inventory_events` | `2026-05-13_create_inventory_events.sql` | Unified lifecycle event log (RECEIVED/TEST_*/PUTAWAY/MOVED/PICKED/PACKED/SHIPPED/ADJUSTED/RETURNED/SCRAPPED/LISTED/NOTE) with `client_event_id` idempotency and last-touch views | Backfilled from `sku_stock_ledger` at create-time |
| `locations` | `2026-04-09_create_locations.sql` + `2026-04-09_upgrade_locations_bin_addressing.sql` + `2026-04-09_rename_zone_to_room.sql` + `2026-05-16_locations_add_zone_letter.sql` | Bin-addressable warehouse map | Used by `/api/locations/[barcode]` and `/api/locations/bulk` |
| `sku_catalog` (+ GTIN) | `2026-04-07_create_sku_catalog_hub.sql` + `2026-05-14_sku_catalog_gtin.sql` + `2026-05-14_sku_catalog_trgm_index.sql` | SKU master with GTIN, trigram search | Hub for product identity |
| `cycle_counts` | `2026-05-14_cycle_counts.sql` | Cycle count headers/lines | New, no UI wired |
| `reason_codes` | `2026-05-14_reason_codes.sql` | Standardized adjustment/disposition reasons | New |
| `printer_profiles` | `2026-05-14_printer_profiles.sql` | Network-printer config | Label generation prerequisite |
| `stock_alerts` | `2026-05-14_stock_alerts.sql` | Low-stock / overstock thresholds | Hooked into `/api/cron/stock-alerts` |
| `multi_warehouse` | `2026-05-14_multi_warehouse.sql` | Multi-warehouse readiness | Schema only |

### 2.2 Inventory tables (legacy, in Drizzle schema)

| Table | Role | Notes |
|---|---|---|
| `items` | Zoho item mirror with `quantity_available`, `quantity_on_hand` | Aggregate counters, mutated by Zoho sync + bin operations |
| `item_location_stock` | Per-Zoho-location quantities | Mirrors Zoho warehouse stock |
| `zoho_locations` | Zoho warehouse master | 6 cols, simple |
| `tech_serial_numbers` | Per-scan serial ledger linked to a shipment/order context via SAL | Legacy serial model; predates `serial_units` |
| `station_activity_logs` (SAL) | Polymorphic event ledger | Central audit reference for tech/pack/FBA |
| `packer_logs` | Packing scan audit | Does not mutate stock |
| `receiving` / `receiving_lines` | Inbound carton + line items | `receiving_lines` writes to `serial_units` and `inventory_events` on `mark-received` |
| `orders` | Single-line fulfillment row per SKU | `status_history` jsonb, no `tester_id` (removed 2026-02-05), shipment derived via `shipment_id` |
| `shipping_tracking_numbers` + `shipment_tracking_events` | Carrier truth | Decoupled from order status; `is_shipped` derived |
| `fba_*` family | FBA shipment plans, items, FNSKU logs | Aggregate `actual_qty`, no serial linkage |

### 2.3 API surface touching inventory

Wired to the new tables:
- `POST /api/receiving/mark-received` — upserts `serial_units`, writes `sku_stock_ledger`, writes `inventory_events` (RECEIVED).
- `PATCH /api/locations/[barcode]` — take/put/set/count, writes `sku_stock_ledger` and `inventory_events`.
- `GET|POST /api/inventory-events` — direct event read/write with `client_event_id` idempotency.
- `GET /api/audit/sku/[sku]` and `/api/audit/bin/[id]` — read joined audit trail.
- `POST /api/receiving/serials`, `PATCH /api/receiving/lines/[id]/(move|putaway|status)`, `GET /api/receiving/lines/[id]/timeline`.
- `GET|PATCH /api/serial-units/[id]`.
- `POST /api/tech/scan-sku`.
- `POST /api/post-multi-sn` (bulk serial entry).
- `POST /api/transfers`.

Not wired to the new tables (still legacy):
- `POST /api/tech/scan` and `POST /api/tech/serial` — write `tech_serial_numbers` and SAL only.
- `POST /api/packing-logs` and `POST /api/packing-logs/start-session` — write `packer_logs` + SAL, set `orders.status='shipped'`. **No `inventory_events.SHIPPED`, no `serial_units.current_status='SHIPPED'`, no stock decrement.**
- `POST /api/fba/shipments/close` and FBA item routes — operate on aggregate `actual_qty` only.
- `POST /api/orders/verify`, `POST /api/orders/next` — no allocation state.

### 2.4 Scan handling

`src/lib/scan-resolver.ts:90` classifies input as `tracking | serial_full | serial_partial | unknown` using ~20 carrier regex patterns. FNSKU detection is regex-only (no catalog lookup). There is no URL parser. GS1 Digital Link (`/01/{gtin}/21/{serial}`) is unrecognized — would currently fall into `unknown`.

### 2.5 Known cross-cutting issues (from `context/CONSISTENCY-GAPS.md` and `context/DEEP-SCAN-FINDINGS.md`)

- 84 files contain raw `BEGIN/COMMIT/ROLLBACK` instead of using `withTransaction()`.
- Three DB-client patterns coexist: raw `pool.query()`, `neonClient.transaction()`, and Drizzle.
- 160 routes call `await req.json()` with no error handler — malformed bodies surface as 500.
- 172 of 196 routes have no rate limiting.
- 61 files contain scattered raw SQL on the `orders` table; no central repository.
- Error response shapes are inconsistent (`{ error }` vs `{ success, message }` vs `{ error: { code, message } }`).

These are not blockers, but every new inventory route should ship with the canonical shape, and a tracked cleanup should run alongside Phase 4–5.

---

## 3. Gap Analysis — Where the System Is Broken

### G1. The decrement event does not exist

When an order ships:
1. Packer scans tracking at `POST /api/packing-logs`.
2. Route resolves shipment, updates `orders.status='shipped'`, inserts `packer_logs`, inserts SAL, uploads photos.
3. **No `inventory_events` row is written. No `serial_units.current_status` transitions to SHIPPED. No `sku_stock_ledger` delta is recorded.** Stock decrement happens (if at all) when an operator later marks the bin via `/api/locations/[barcode]` PATCH action=take.

This is the core defect: **shipment is an audit-only event, not a stock-mutating event.** Net effect: inventory drifts unless humans remember to bin-out matching quantity.

### G2. Two parallel serial models

`tech_serial_numbers` (legacy, Drizzle-typed) and `serial_units` (new, raw SQL) coexist with no FK between them. A serial captured at tech station does not flow into `serial_units`. A serial captured at receiving lives in both `serial_units` and on a `receiving_lines` upsert. This breaks "what is the lifecycle of serial #X" queries.

### G3. The Drizzle schema is out of date

`serial_units`, `inventory_events`, `sku_stock_ledger`, `locations`, `sku_catalog`, `cycle_counts`, `reason_codes`, `printer_profiles`, `stock_alerts` are **not** declared in `src/lib/drizzle/schema.ts`. All access is raw SQL. This is an immediate quality risk — any new feature that needs typed queries on these tables has to reinvent the type.

### G4. No ALLOCATED state

Orders move directly from "available stock" to "shipped". There is no:
- Reservation step that prevents two orders from claiming the same unit
- Per-order serial pick list
- Allocation cancellation path

This is the "pre-packed bucket" problem v1 called out, and it is real. Fix: add `ALLOCATED` and `PICKED` as states in `serial_units.current_status` (already enum candidates) and as `inventory_events` event types.

### G5. Scan resolver does not understand QR URLs

A phone scan of a GS1 Digital Link QR (`https://inv.example.com/01/00614141999996/21/IPH13-128-BLU-2026-000142`) yields a URL string. `classifyInput()` returns `unknown`. Until we add a URL parser ahead of pattern matching, the entire GS1 labeling plan is blocked.

### G6. FBA flow is aggregate-only

`fba_shipment_items` tracks `expected_qty` and `actual_qty`. There is no link table from a shipment item to the specific `serial_units.id` values that fulfilled it. For non-serialized SKUs that's fine; for refurbished electronics it leaves the same audit hole as the orders flow.

### G7. Receiving disposition does not create stock rows

When `receiving_lines.disposition_code` is set to `ACCEPT`, no `sku_stock` (bin) row is created or incremented automatically. The serial enters `serial_units` with state `RECEIVED` but is not yet `STOCKED`, and there is no putaway-on-disposition handler. Stock visibility depends on a separate manual bin-put.

### G8. Photos are not linked to events

`photos` is polymorphic over entity_type (PACKER_LOG, RECEIVING, REPAIR_SERVICE, SKU). Photo capture during receiving/test/grade does not link to the `inventory_events` row, so the "photo at the moment of state X" query requires joining via entity_type + entity_id + timestamps.

### G9. No condition history per unit

`serial_units.condition_grade` is current-value only. The 2026-04-10 migration did not include a history table. To answer "did this unit's grade ever change after receiving?" you need to derive it from `inventory_events.payload`, which is not enforced.

### G10. No order → unit allocation table

The order schema has one row per SKU per order with a text `quantity`. For serialized orders, there is no normalized table of `(order_id, unit_id)` pairs.

---

## 4. Target Architecture

### 4.1 Core principles (kept from v1, re-stated)

- **Inventory is a state machine, not a counter.** The counter (`items.quantity_available`, bin qty) is a derived view of the state machine.
- **Single decrement event at SHIPPED.** No state earlier in the pipeline decrements stock.
- **Identity is separate from attributes.** A unit's GS1 QR encodes only its unique unit ID. Condition, location, state, and order assignment are looked up.
- **Three tiers of granularity.** Tier 1 (bulk), Tier 2 (SKU-tracked), Tier 3 (serialized). All three flow through one event model.
- **Every state change is an `inventory_events` row** with `client_event_id` for mobile idempotency.

### 4.2 What changes vs. v1

| v1 said | v2 says |
|---|---|
| Create `units`, `stock`, `unit_*_history`, `audit_log` | Use the existing `serial_units`, `sku_stock_ledger`, `inventory_events`. Add only what's missing: `serial_unit_condition_history`, `order_unit_allocations`, optional `fba_shipment_item_units`. |
| New `products` table with `tracking_tier` enum | Add `tracking_tier` to existing `sku_catalog`. Don't fork product identity. |
| New `packages` table | The pair `shipping_tracking_numbers` + `shipment_tracking_events` already plays this role for outbound. Add `package_units` join if/when serial-per-package matters. |
| Single shared `audit_log` for everything | Keep two complementary logs: `inventory_events` for inventory lifecycle (typed event_type, idempotent, mobile-friendly) and `station_activity_logs` for scan-station UX context. Cross-link via `inventory_events.payload.sal_id`. |
| Domain `inv.yc.com` | Use existing product canonical domain; route under a stable path like `/q/...` and `/01/...`. |

### 4.3 State machine (canonical)

States (per Tier 3 unit, with parallel semantics for Tier 1/2 stock rows):

```
RECEIVED ─► TRIAGED ─► IN_REPAIR ─► REPAIR_DONE ─► IN_TEST ─► GRADED ─► STOCKED
                          │              │            │
                          ▼              ▼            ▼
                       SCRAPPED      SCRAPPED     IN_REPAIR (failed test)

STOCKED ─► ALLOCATED ─► PICKED ─► PACKED ─► LABELED ─► STAGED ─► SHIPPED
                │           │         │
                ▼           ▼         ▼
             STOCKED     STOCKED   STOCKED   (cancel paths)

SHIPPED ─► RETURNED ─► TRIAGED   (re-enter refurb)
ANY ─► ON_HOLD ─► (previous state)
```

`serial_units.current_status` enum needs to be expanded from the current `(UNKNOWN | RECEIVED | TESTED | STOCKED | PICKED | SHIPPED | RETURNED | RMA | SCRAPPED)` to add: `TRIAGED`, `IN_REPAIR`, `REPAIR_DONE`, `IN_TEST`, `GRADED`, `ALLOCATED`, `PACKED`, `LABELED`, `STAGED`, `ON_HOLD`. (Drop `UNKNOWN` after backfill; treat it as a temporary import bucket.)

### 4.4 Decrement contract

`items.quantity_available` and `item_location_stock.quantity_available` become **derived views** materialized from `sku_stock_ledger`:

```sql
CREATE OR REPLACE VIEW v_item_qty AS
SELECT sku, SUM(delta) AS qty_available
FROM sku_stock_ledger
GROUP BY sku;
```

Application reads go through this view (or a periodically refreshed materialized view if performance demands). The `items.quantity_available` column is retained for Zoho-sync compatibility but is written to only by the Zoho sync job, not by warehouse operations.

The only event that produces a `sku_stock_ledger` row with `reason='SOLD'` is the SHIPPED handler — see §6.

---

## 5. Schema Decisions and Reconciliation

### 5.1 Bring the new tables into Drizzle

Add to `src/lib/drizzle/schema.ts`:

- `serialUnits` (existing migration; add `pgTable` declaration)
- `inventoryEvents` (existing migration)
- `skuStockLedger` (existing migration)
- `locations` (bin-addressable; existing migration set)
- `skuCatalog` (existing migration; with `gtin` column)
- `reasonCodes`
- `printerProfiles`
- `stockAlerts`
- `cycleCounts` + `cycleCountLines`

Acceptance: `drizzle-kit pull` (or manual declaration) yields no schema drift; new repository functions in `src/lib/repositories/inventory/*` use typed queries.

### 5.2 New tables (the ones v1 was right about)

#### `serial_unit_condition_history` (new)

```sql
CREATE TABLE serial_unit_condition_history (
  id BIGSERIAL PRIMARY KEY,
  serial_unit_id INTEGER NOT NULL REFERENCES serial_units(id) ON DELETE CASCADE,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assessed_by_staff_id INTEGER REFERENCES staff(id),
  prev_grade condition_grade_enum,
  new_grade condition_grade_enum NOT NULL,
  cosmetic_notes TEXT,
  functional_notes TEXT,
  inventory_event_id BIGINT REFERENCES inventory_events(id),
  CONSTRAINT chk_grade_changed CHECK (prev_grade IS DISTINCT FROM new_grade)
);
CREATE INDEX idx_such_unit_time ON serial_unit_condition_history (serial_unit_id, assessed_at);
```

#### `order_unit_allocations` (new)

```sql
CREATE TABLE order_unit_allocations (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  serial_unit_id INTEGER NOT NULL REFERENCES serial_units(id) ON DELETE RESTRICT,
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  allocated_by_staff_id INTEGER REFERENCES staff(id),
  state TEXT NOT NULL CHECK (state IN ('ALLOCATED','PICKED','PACKED','SHIPPED','RELEASED')),
  released_at TIMESTAMPTZ,
  released_reason TEXT,
  UNIQUE (serial_unit_id) DEFERRABLE INITIALLY DEFERRED  -- one live allocation per unit
);
CREATE INDEX idx_oua_order ON order_unit_allocations (order_id, state);
```

Uniqueness on `serial_unit_id` enforces "a unit can be allocated to at most one open order". Released allocations move to `state='RELEASED'` and the row stays for history.

#### `fba_shipment_item_units` (new, optional for Phase 5)

```sql
CREATE TABLE fba_shipment_item_units (
  fba_shipment_item_id BIGINT NOT NULL REFERENCES fba_shipment_items(id) ON DELETE CASCADE,
  serial_unit_id INTEGER NOT NULL REFERENCES serial_units(id) ON DELETE RESTRICT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by_staff_id INTEGER REFERENCES staff(id),
  PRIMARY KEY (fba_shipment_item_id, serial_unit_id)
);
```

### 5.3 Enum expansions

```sql
ALTER TYPE serial_unit_status_enum ADD VALUE IF NOT EXISTS 'TRIAGED';
-- repeat for IN_REPAIR, REPAIR_DONE, IN_TEST, GRADED, ALLOCATED, PACKED, LABELED, STAGED, ON_HOLD
```

Add `inventory_events.event_type` values: `ALLOCATED`, `RELEASED`, `TRIAGED`, `REPAIR_STARTED`, `REPAIR_COMPLETED`, `GRADED`, `LABELED`, `STAGED`, `HELD`, `RELEASED_HOLD`. The column is TEXT today (not an enum), so this is a documentation change plus a CHECK constraint update.

### 5.4 Reconcile `tech_serial_numbers` with `serial_units`

Add `serial_unit_id INTEGER REFERENCES serial_units(id)` to `tech_serial_numbers`. Backfill by `normalized_serial`. New tech scans should:

1. Upsert into `serial_units` (find-or-create by `normalized_serial`).
2. Write `tech_serial_numbers` with the FK set.
3. Write `inventory_events` (IN_TEST or GRADED depending on action).

Once backfilled, `tech_serial_numbers` becomes purely a UX/audit table for the tech station screen; `serial_units` is the unit of record.

### 5.5 `items` and `item_location_stock`

Keep as Zoho mirror. Add comment in schema noting they are no longer authoritative for warehouse operations. Add a one-way sync job (warehouse → Zoho) that runs after every SHIPPED event and pushes the new `quantity_available` to Zoho. Read paths that need "current available" should switch from `items.quantity_available` to the materialized view from `sku_stock_ledger`.

---

## 6. Workflow Wire-Up

Each subsection describes the new behavior of an existing route, the events it must emit, and the file that changes.

### 6.1 Receiving — already partly done

**Route:** `src/app/api/receiving/mark-received/route.ts`

Today: writes `serial_units` upsert (lines ~112–119), updates `receiving_lines`, pushes to Zoho.

Add:
- Emit `inventory_events` row with `event_type='RECEIVED'`, `next_status='RECEIVED'`, `serial_unit_id`, `sku`, `bin_id` (if scanned destination is a bin), `receiving_line_id`, `client_event_id` (from request body).
- If disposition is ACCEPT and a destination bin is provided in the same request, also emit `event_type='PUTAWAY'`, transition unit to `STOCKED`, and write a `sku_stock_ledger` row `(delta=+qty, reason='RECEIVED')`. Today the route stops at MATCHED/DONE and leaves the bin-put to a separate manual action — fold them when the operator scans a destination bin in the same flow.
- Emit `event_type='SCRAPPED'` + `sku_stock_ledger` `(delta=0, reason='DAMAGED')` (or no ledger row at all, since unit never made stock) when disposition is SCRAP/RTV. Set `serial_units.current_status='SCRAPPED'`.

Acceptance: every `receiving/mark-received` call leaves the receiving line, the unit (if serialized), the ledger (if bulk), and `inventory_events` consistent in a single transaction.

### 6.2 Tech station — biggest wiring job

**Routes:** `src/app/api/tech/scan/route.ts`, `src/app/api/tech/serial/route.ts`, `src/lib/tech/insertTechSerialForTracking.ts`

Today: writes `tech_serial_numbers` + SAL + appends to `orders.status_history`.

Add (in `insertTechSerialForTracking` and the SCAN_SKU action):
- Resolve or create `serial_units` row by `normalized_serial`.
- Write `tech_serial_numbers.serial_unit_id` (new column).
- Emit `inventory_events`:
  - On test start: `event_type='TEST_START'`, `prev_status=current`, `next_status='IN_TEST'`.
  - On pass: `event_type='TEST_PASS'`, `next_status='GRADED'` (then `STOCKED` after putaway scan).
  - On fail: `event_type='TEST_FAIL'`, `next_status='IN_REPAIR'`.
- For order-context scans (tech is staging a tracking-bound order): no state change yet. The serial is "noted as expected" but not allocated. Allocation happens at the order/allocation step (§6.3), not here.

This requires deciding whether the existing tech station screen is doing two jobs (test/grade vs. associate-serial-with-order) and splitting them in the API. The existing `serialType` field already distinguishes SERIAL vs. FNSKU — extend with TEST_PASS / TEST_FAIL action types, or split routes.

### 6.3 Order allocation — new

**Routes:** new `POST /api/orders/[id]/allocate` and `POST /api/orders/[id]/release`.

Trigger: incoming Zoho order webhook (or manual operator action).

Logic:
1. For each order line (currently one row per `orders.id`):
   - If Tier 1/2: reserve `quantity` from `sku_stock_ledger` view of "available" by writing a row `(delta=-quantity, reason='ALLOCATED', ...)` — except we don't want allocation to decrement available, we want it to **reduce sellable-to-others**. Solution: a second view `v_sku_committed` = `SUM(delta) WHERE reason='ALLOCATED' AND released_at IS NULL`, and `available_to_promise = sum(all deltas) - committed`. **Do not write a negative delta for allocation.** Instead write to `order_unit_allocations` (for serialized) or to a parallel `sku_commitments` view derived from `inventory_events.event_type='ALLOCATED'`.
   - If Tier 3: pick specific `serial_units.id` rows matching SKU + condition, oldest STOCKED first. Insert one `order_unit_allocations` row per unit with `state='ALLOCATED'`. Update `serial_units.current_status='ALLOCATED'`. Emit `inventory_events.event_type='ALLOCATED'`.
2. Emit a single `order_allocated` SAL row for UX.

Release path: undo all of the above; set state to `RELEASED`, units return to `STOCKED`.

### 6.4 Picking — new

**Route:** new `POST /api/pick/scan` invoked by a mobile pick app.

For each scanned unit (Tier 3) or scanned bin + qty (Tier 1/2):
- Validate scanned `serial_unit_id` against an open `order_unit_allocations.state='ALLOCATED'` row for the active picker.
- Transition `serial_units.current_status='PICKED'`, update `order_unit_allocations.state='PICKED'`.
- Emit `inventory_events.event_type='PICKED'`.

Mismatch handling: warn but allow override with mandatory reason; log `manual_override` event.

### 6.5 Packing — fix the decrement

**Routes:** `src/app/api/packing-logs/route.ts`, `src/app/api/packing-logs/start-session/route.ts`.

Today: marks `orders.status='shipped'`, writes `packer_logs`, no inventory mutation.

Change order of operations:
1. Resolve the order's allocations (`order_unit_allocations` rows).
2. For each expected unit, require a scan. Verify scanned `serial_unit_id` matches an allocation.
3. On all-units-scanned: emit `inventory_events.event_type='PACKED'`, set `order_unit_allocations.state='PACKED'`, set `serial_units.current_status='PACKED'`.
4. Generate label (carrier API call), emit `inventory_events.event_type='LABELED'`, set state `LABELED`.
5. **At the manifest/shipped moment** (currently the same packer scan): emit `inventory_events.event_type='SHIPPED'`, set `serial_units.current_status='SHIPPED'`, **write `sku_stock_ledger` `(delta=-qty, reason='SOLD')` per shipped unit/quantity**, set `orders.status='shipped'`, write `packer_logs`, write SAL.

This is the one transaction in the whole system that turns a state change into a stock decrement. It must run in a single DB transaction.

For backwards compatibility during rollout, gate the new behavior behind a feature flag `INVENTORY_V2_PACKING` so the old path remains available until allocations are populated for all in-flight orders.

### 6.6 FBA — phase 2 of the wire-up

**Routes:** `src/app/api/fba/items/{ready,scan,verify}`, `src/app/api/fba/shipments/close`.

For each FBA scan today: write `fba_fnsku_logs`, bump `fba_shipment_items.actual_qty`, advance status.

Change: if the FNSKU resolves to a Tier 3 SKU, also write `fba_shipment_item_units` rows with the `serial_unit_id` (resolved from the same scan if the unit was previously labeled, or from a follow-up scan of the unit's QR before drop-into-FBA-box). On close: emit `inventory_events.event_type='SHIPPED'` per linked unit, write `sku_stock_ledger` `(delta=-qty, reason='SOLD')`. For Tier 1/2 FNSKUs, the close handler writes a single `sku_stock_ledger` row per FBA item line.

### 6.7 Returns

**Routes:** new `POST /api/returns/intake`.

Steps:
1. Scan return label or package QR.
2. Look up original order via tracking. For each unit on the order, mark `inventory_events.event_type='RETURNED'`, set `serial_units.current_status='RETURNED'`, write `sku_stock_ledger` `(delta=+qty, reason='RETURNED')`.
3. Operator runs triage scan to push the unit back into the refurb flow (state `TRIAGED`).

### 6.8 Holds

`POST /api/serial-units/[id]/hold` and `/release` — write `inventory_events.event_type='HELD'` / `RELEASED_HOLD`, set `current_status='ON_HOLD'`, store previous state in `inventory_events.payload.prev_status` for restore.

---

## 7. Scan and Label System (GS1 Digital Link)

### 7.1 Scan resolver upgrade

`src/lib/scan-resolver.ts:classifyInput()` adds a URL branch ahead of pattern matching:

```ts
type ScannedEntity =
  | { type: 'unit'; gtin: string; unitId: string }
  | { type: 'stock'; skuId: string }
  | { type: 'location'; locationId: string }
  | { type: 'package'; trackingNumber: string }
  | { type: 'order'; orderId: string }
  | { type: 'tracking'; carrier: string; tracking: string }
  | { type: 'fnsku'; fnsku: string }
  | { type: 'serial_full' | 'serial_partial'; value: string }
  | { type: 'unknown'; raw: string };

function classifyInput(raw: string): ScannedEntity {
  const trimmed = raw.trim();

  // 1. GS1 Digital Link URL
  if (/^https?:\/\//i.test(trimmed)) {
    const url = safeParseURL(trimmed);
    if (url) {
      const seg = url.pathname.split('/').filter(Boolean);
      if (seg[0] === '01' && seg[2] === '21') return { type: 'unit', gtin: seg[1], unitId: seg[3] };
      if (seg[0] === 'l') return { type: 'location', locationId: seg[1] };
      if (seg[0] === 'p') return { type: 'package', trackingNumber: seg[1] };
      if (seg[0] === 'o') return { type: 'order', orderId: seg[1] };
      if (seg[0] === 's') return { type: 'stock', skuId: seg[1] };
    }
  }

  // 2. Existing tracking/FNSKU/serial path (unchanged)
  ...
}
```

### 7.2 URL routing

Server: add a thin Next.js route group under `src/app/(public-scan)/`:

| Pattern | Behavior |
|---|---|
| `/01/[gtin]/21/[unitId]` | Public unit page (SKU info, condition, photos, warranty); admin sees full lifecycle |
| `/l/[locationId]` | Auth-only bin contents page |
| `/p/[trackingNumber]` | Public tracking redirect (carrier deep-link) |
| `/o/[orderId]` | Auth-only order detail |
| `/s/[skuId]` | Public SKU storefront stub or admin bin overview |

Internal API: `GET /api/resolve?url={url}` returns full entity record with allowed-action list scoped to the caller's role.

### 7.3 Unit ID format

`{SKU_SHORT}-{YEAR}-{SEQ6}` — e.g., `IPH13-128-BLU-2026-000142`. Allocate via a per-SKU-per-year sequence in a small `unit_id_sequences` table. Existing serials imported from legacy keep their `tech_serial_numbers.serial_number` and pop into `serial_units.serial_number`; the `serial_units.id` (bigserial) remains the internal handle.

### 7.4 GTIN strategy

`sku_catalog.gtin` (added 2026-05-14) is the field. For Phase 1 use internal pseudo-GTINs in the GS1 reserved range (`04`-prefix indicator + your assigned company prefix once allocated). Real GS1 membership is gated to "selling on a major retail channel" and is a separate budget decision (Open Q #2).

### 7.5 Label generation

Wire `printer_profiles` (already migrated) to a `/api/labels/print` endpoint that takes `(entity_type, entity_id, printer_profile_id, copies)` and renders ZPL/PDF. Templates per entity:
- Unit label (50×50mm): QR + product name + SKU + unit ID + intake date + optional condition sticker.
- Location label (75×50mm): QR + location code in large font.
- Package label: generated by carrier API; package QR added as auxiliary sticker.

Templates live in `src/lib/labels/templates/*.ts`.

---

## 8. Event and Audit Model

### 8.1 Two complementary logs

| Log | Owner | Purpose | Key |
|---|---|---|---|
| `inventory_events` | Inventory module | Per-unit / per-SKU lifecycle, idempotent, mobile-friendly | `client_event_id` UNIQUE |
| `station_activity_logs` (SAL) | Station/UX module | Scanner station session context, polymorphic refs to fba/tech/packer entities | `id` PK, joined by entity FKs |

The relationship: every `inventory_events` row can carry `payload.sal_id` referencing the SAL row that triggered it. Every SAL row that mutates inventory **must** have a corresponding `inventory_events` row created in the same transaction.

### 8.2 Idempotency contract

Mobile and desktop clients generate a `client_event_id` (UUID v4) per scan. Server-side `INSERT INTO inventory_events (...) ON CONFLICT (client_event_id) DO NOTHING RETURNING *`. If no row returned, fetch the original and return it. This is already supported by the migration; routes need to honor it.

### 8.3 Photo linkage

Add `inventory_event_id BIGINT REFERENCES inventory_events(id)` to `photos`. Receiving intake photos, condition assessment photos, packing photos, and return photos all link directly to the event that produced them, not just to the entity.

### 8.4 Retention

`inventory_events` rows are immutable. Plan a monthly archive job: rows older than 2 years move to `inventory_events_archive` (same schema, compressed table or partitioned by year). Hot path always queries the live table; investigations join archive on demand.

---

## 9. Migration and Backfill Strategy

### 9.1 Pre-cutover

1. Declare new and existing inventory tables in Drizzle schema (§5.1) — pure refactor, zero behavior change.
2. Add the new tables (`serial_unit_condition_history`, `order_unit_allocations`, `fba_shipment_item_units`, `unit_id_sequences`).
3. Expand `serial_unit_status_enum` (§5.3).
4. Add `tech_serial_numbers.serial_unit_id` FK + backfill by `normalized_serial`.
5. Build new repository functions in `src/lib/repositories/inventory/`.
6. Ship the GS1 scan resolver as additive (URL branch). All existing scans still classify the same way.
7. Ship `/api/labels/print` behind admin auth.

### 9.2 Cutover (per workflow, behind feature flags)

Flags:
- `INVENTORY_V2_RECEIVING_PUTAWAY` — combined receive + putaway transaction
- `INVENTORY_V2_TECH_LIFECYCLE` — tech writes to `serial_units` + `inventory_events`
- `INVENTORY_V2_ALLOCATION` — order allocation enabled
- `INVENTORY_V2_PACKING` — packer flow emits SHIPPED + decrements
- `INVENTORY_V2_FBA_SERIAL_LINK` — FBA links units
- `INVENTORY_V2_RETURNS` — returns intake

Each flag flips on independently after that workflow's UI + API + dashboard are validated.

### 9.3 Stock reconciliation

Before flipping `INVENTORY_V2_PACKING`:
1. Snapshot current `items.quantity_available` per SKU.
2. Compute `SUM(delta)` per SKU from `sku_stock_ledger`.
3. For any discrepancy, write a one-off `sku_stock_ledger` row with `reason='ADJUSTMENT'` and the difference, with a single audit note tying to a "v2 reconciliation".
4. After this, the ledger view becomes authoritative for reads.

### 9.4 Legacy serial backfill

For every distinct `(normalized_serial)` in `tech_serial_numbers` not present in `serial_units`:
- Insert into `serial_units` with `current_status='UNKNOWN'`.
- Inspect the latest related `orders.status` / `shipping_tracking_numbers.is_terminal` to infer a real state (`SHIPPED` if delivered, else `STOCKED`).
- Update `tech_serial_numbers.serial_unit_id`.
- Emit a single `inventory_events.event_type='NOTE'` with `payload.import_source='legacy_tsn'`.

### 9.5 Label rollout

Existing units with legacy `SKU:A01`-style or paper-only labels stay readable. The scan resolver's legacy parser branch (existing pattern matching) keeps working. New intake from cutover gets GS1 QR labels. Optional: re-label oldest in-stock units in slow periods.

---

## 10. Phased Rollout

Calibrated to the actual codebase. Each phase ends with a flag-flip and a metrics check (§13).

### Phase 0 — Schema and ORM alignment (1 week)
- Declare existing inventory tables in Drizzle schema.
- Add missing tables and enum values.
- Add `tech_serial_numbers.serial_unit_id` + backfill.
- Build `src/lib/repositories/inventory/` with typed helpers.
- **Exit:** no app-level behavior change; types compile; all inventory tables typed.

### Phase 1 — Scan resolver + label print (1 week)
- Ship GS1 Digital Link branch in `classifyInput()`.
- Stand up `/api/labels/print` and the three label templates.
- Stand up `/q/...` and `/01/.../21/...` public routes (read-only).
- **Exit:** scanning a printed QR at the warehouse opens the right entity screen.

### Phase 2 — Receiving putaway in one step (1 week)
- Flip `INVENTORY_V2_RECEIVING_PUTAWAY`.
- `mark-received` becomes a single transaction: line update + serial upsert + ledger row + `inventory_events.PUTAWAY` (if bin scanned) + Zoho push.
- **Exit:** receiving the same SKU twice produces two `inventory_events` rows with matching ledger deltas; bin shows the new qty without a separate `/locations` PATCH.

### Phase 3 — Tech station rewired (2 weeks)
- Flip `INVENTORY_V2_TECH_LIFECYCLE`.
- `tech/scan` and `tech/serial` write to `serial_units` and `inventory_events`.
- Tech station UI gains TEST_PASS / TEST_FAIL / GRADED actions producing the right events.
- **Exit:** `serial_units.id` reachable from any tech-station scan; tech-station serial timeline query joins `serial_units` + `inventory_events` only.

### Phase 4 — Order allocation (2 weeks) — fixes the double-counting
- Build `order_unit_allocations` + allocation API.
- Build the pick app or pick screen.
- Flip `INVENTORY_V2_ALLOCATION`.
- New orders auto-allocate on Zoho webhook intake (Tier 3 picks specific units; Tier 1/2 reserves quantity via committed-view).
- **Exit:** "available to promise" = on-hand − committed; cancel-before-pick releases cleanly.

### Phase 5 — Packing + single decrement (2 weeks) — the core fix
- Flip `INVENTORY_V2_PACKING`.
- Packer flow now requires scan-verify before SHIPPED.
- SHIPPED transaction writes `inventory_events`, mutates `serial_units`, writes `sku_stock_ledger`, sets `orders.status`, writes packer log + SAL — all in one transaction.
- Zoho sync job pushes new quantity to Zoho after SHIPPED.
- **Exit:** every shipped order decrements stock exactly once; bin qty + ledger qty + Zoho qty agree within sync interval.

### Phase 6 — FBA serial linkage (2 weeks)
- Flip `INVENTORY_V2_FBA_SERIAL_LINK`.
- For Tier 3 FNSKUs, scan flow links specific units to FBA item lines.
- Close shipment emits SHIPPED + ledger decrements per unit.
- **Exit:** FBA shipment manifests are reproducible from `fba_shipment_item_units` joined to `serial_units`.

### Phase 7 — Returns + holds (1 week)
- Flip `INVENTORY_V2_RETURNS`.
- Return intake screen + API. Hold/release endpoints.
- **Exit:** a returned unit re-enters refurb with its previous lifecycle visible.

### Phase 8 — Reporting, cycle counts, polish (ongoing)
- Wire `cycle_counts` UI.
- Build reports: per-SKU on-hand, per-condition aging, per-station throughput, repair cost-per-unit, source-quality analytics.
- Photo cold-storage migration job.
- Optional marketplace integrations.

Total: **~12 weeks of focused work**, well below v1's 24-week estimate, because most of the schema already exists.

---

## 11. Cross-Cutting Code Cleanup

Run alongside Phases 3–5, since the new inventory routes will be canonical examples of "the right way":

1. **Centralized `withTransaction()`** — migrate raw `BEGIN/COMMIT/ROLLBACK` in inventory-adjacent files (84 total project-wide; start with the ~25 in inventory paths).
2. **Safe `req.json()`** — adopt a `parseJson(req)` helper that returns `{ok, data} | {ok:false, error}` and use it in every new inventory route.
3. **Rate limits** — add to `/api/labels/print`, `/api/pick/scan`, `/api/returns/intake`, and the high-traffic `/api/locations/[barcode]` (last is the most-hit inventory endpoint).
4. **Error response shape** — adopt the `{ ok: boolean, error?: { code, message }, data?: T }` shape consistently in `/api/inventory-events`, `/api/serial-units`, `/api/labels`, etc.
5. **Orders repository** — extract the order-by-tracking lookup (used in 61 files) into `src/lib/repositories/orders/` and call it from packer + tech + allocation paths.
6. **`SELECT *` cleanup** — convert reads on hot tables (`serial_units`, `inventory_events`, `sku_stock_ledger`) to typed column lists via Drizzle.

These are not blockers but the inventory rewrite is a natural moment to set the example.

---

## 12. Open Decisions

| # | Decision | Recommendation | Blocker for |
|---|---|---|---|
| 1 | GS1 membership and real GTINs | Internal pseudo-GTINs in Phase 1; revisit when listing on Amazon retail or Back Market | None |
| 2 | Public scan domain | Reuse existing customer-facing domain under `/q/`, `/01/`, `/l/`, etc. | Phase 1 |
| 3 | Unit ID format for legacy units | Keep existing serials (`tech_serial_numbers.serial_number`); only newly intaked units get the structured `{SKU}-{YEAR}-{SEQ}` format | Phase 2 |
| 4 | Grading scale (5-tier vs current 5-grade enum BRAND_NEW/USED_A/USED_B/USED_C/PARTS) | Keep existing enum; map to v1's like_new/very_good/good/acceptable/for_parts in display only | Phase 3 |
| 5 | Photo storage backend | Vercel Blob today; plan cold-storage migration for >12-month-old photos in Phase 8 | Phase 8 |
| 6 | Label printer choice | Brother QL or Zebra ZD420; `printer_profiles` already supports either | Phase 1 |
| 7 | Carrier integration order | Whichever the warehouse currently ships most via — likely UPS first (shipping backbone already exists) | Phase 5 |
| 8 | Allocation concurrency model | DEFERRABLE unique on `order_unit_allocations.serial_unit_id` + advisory locks per SKU during bulk allocation | Phase 4 |
| 9 | Offline mode on mobile | Defer to Phase 8 unless warehouse Wi-Fi is unreliable; `client_event_id` already makes offline-then-sync safe | Phase 8 |
| 10 | Zoho sync direction at SHIPPED | One-way warehouse → Zoho push; Zoho webhook only consulted for new orders, not for stock | Phase 5 |
| 11 | Tier classification of existing SKUs | Run a one-time SKU-by-SKU review with operations; default refurbished electronics to Tier 3, accessories to Tier 1/2 | Phase 4 |
| 12 | Multi-warehouse activation | Schema is ready (`2026-05-14_multi_warehouse.sql`); leave dormant unless second site opens | Phase 8 |

---

## 13. Success Metrics

Track these from Phase 2 onward. Each phase's exit gate is "metric within tolerance for 7 consecutive days":

- **Stock accuracy:** for every SKU, `items.quantity_available` − `SUM(sku_stock_ledger.delta)` = 0. Tolerance at cutover: 0%.
- **Decrement uniqueness:** count of `inventory_events.event_type='SHIPPED'` per order = order's expected unit count. Tolerance: 100%.
- **Allocation coverage:** % of new orders that have an `order_unit_allocations` row within 60s of Zoho intake. Target 100% by end of Phase 4.
- **Pick-mismatch rate:** % of `inventory_events.event_type='PICKED'` rows with `payload.mismatch=true`. Should trend toward zero.
- **Lifecycle reachability:** for a random sample of 50 serials per week, `inventory_events` returns ≥2 rows covering RECEIVED→…→STOCKED or further. Target 100% post Phase 3.
- **Audit trail completeness:** every state change in `serial_units` has a matching `inventory_events` row (DB trigger check; logs violations to an alert table).
- **API latency:** `/api/inventory-events` p95 < 200ms; `/api/pick/scan` p95 < 150ms (must feel instant on a phone).

---

*End of v2. v1 retained in git history; treat that as the conceptual sketch and this as the execution plan.*
