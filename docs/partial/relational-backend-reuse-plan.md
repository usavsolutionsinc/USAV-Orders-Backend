# Relational Backend — Reusable-Pattern Consolidation Plan

**LIVING ROADMAP — P1 done, P2 half (32%).** Status verified 2026-06-28.

**Status:** Proposal / deep-scan findings
**Date:** 2026-06-06
**Scope:** `src/lib/drizzle/schema.ts`, `src/lib/inventory/**`, `src/lib/neon/**`, `src/lib/repositories/**`, `src/app/api/**`

---

## 0. Thesis

The backbone for a clean relational model **already exists**. There is a per-unit aggregate root
(`serial_units`), a unified lifecycle timeline (`inventory_events`), a signed-delta quantity ledger
(`sku_stock_ledger`), a typed reason-code table, a polymorphic entity pattern, and a central product
hub (`sku_catalog`). The problem is **half-adoption**: the same concept is written through a clean
canonical helper in some routes and re-implemented with raw SQL in others, and several "loops" are
designed but never closed.

The user's flagship example — *scan a return, scan its serial, pair it back to the serial that shipped*
— is the perfect illustration: **the pairing query already exists and works, but only on the read side.**
This plan generalizes that example into a set of reusable patterns and a phased path to apply each one
everywhere it belongs.

---

## 1. The flagship pattern: cradle-to-grave unit identity + reverse-linking

### 1.1 What exists today

| Piece | Location | State |
|---|---|---|
| Per-unit aggregate root, `UNIQUE(normalized_serial)` | `serial_units` (`schema.ts:1603`) | ✅ canonical |
| Single upsert writer | `upsertSerialUnit()` (`lib/neon/serial-units-queries.ts:268`) | ✅ canonical, return-aware (SHIPPED→RECEIVED flips to `RETURNED`, `serial-units-queries.ts:101`) |
| Outbound link | `order_unit_allocations` (state `ALLOCATED→PICKED→PACKED→SHIPPED→RELEASED`, `schema.ts:1842`) | ✅ written on pack/ship (`api/pack/ship/route.ts:196`) |
| **Shipped-order lookup for a returned serial** | `findShippedOrderForSerialUnit()` / `findShippedOrderByTsnSerial()` (`serial-units-queries.ts:154,191`) | ⚠️ **read-only** — wired into `api/serial-units/lookup/route.ts:59,64` only |
| Returns write path | `lib/inventory/returns.ts:65` | ⚠️ takes `orderId` as **operator input**, never resolves it |

### 1.2 The gap (the open loop)

`returns/intake` marks a unit `RETURNED`, writes a `RETURN_CUSTOMER` ledger row and a `RETURNED`
event — but:

1. It **never calls** `findShippedOrderForSerialUnit()`, even though that function exists and is proven on the read side.
2. It **never persists** the shipped↔returned link (no `receiving.order_id`, no `return_dispositions.original_order_id`).
3. It **never transitions** the original `order_unit_allocations` row out of `SHIPPED`, so "show all returns for order X" is not a JOIN — it's impossible.

### 1.3 The reusable pattern to extract: **"reverse-link on inbound"**

> When any unit re-enters the building (return, RMA, RTV, warranty, repair intake), resolve its prior
> outbound context from its durable identity, persist that link, and advance the prior allocation's state —
> all in the same transaction that records the inbound event.

This is not return-specific. The same shape applies to: RMA receipt, repair check-in of an item we shipped,
FBA removal-order returns, and refurb re-intake.

### 1.4 Work items — DONE 2026-06-28

Phase 1 flagship loop is shipped: `resolvePriorOutbound()` (`serial-units-queries.ts`) is called from
`returns.ts` + `rma/authorizations.ts`; migration `2026-06-06_close_return_loop.sql` adds the `RETURNED`
allocation state + `returned_at`/`reason` + index; the returns path flips `SHIPPED → RETURNED` in-tx.

- **DB:** [x] add `receiving.original_order_id` (FK `orders.id`, nullable) and `return_dispositions.original_order_id`/`original_shipment_id`. Add allocation state `RETURNED` (or a `returned_at`/`returned_via_receiving_id` column on `order_unit_allocations`).
- **Code:** [x] in `lib/inventory/returns.ts` (and the RMA `markReceived`/`recordDisposition` path), after `findByNormalizedSerial`, call `findShippedOrderForSerialUnit()`; if found and `input.orderId` is null, auto-fill it (or surface for confirm); write the link; `UPDATE order_unit_allocations SET state='RETURNED' WHERE serial_unit_id=$1 AND state='SHIPPED'`.
- **Reuse:** [x] extract a single `resolvePriorOutbound(serialUnitId)` helper so RMA, returns, and repair-intake all share it.
- **Payoff:** "returns for order X", "is this the unit we shipped, or a swap?", RMA validation, and warranty-window checks all become trivial JOINs.

---

## 2. Collapse the fragmented write helpers into one unit-event façade

### 2.1 Findings

There are **two parallel event-writer APIs** and **5+ ad-hoc `tech_serial_numbers` writers**:

- Events — raw SQL `recordInventoryEvent()` (`lib/inventory/events.ts:89`) **vs** Drizzle `appendInventoryEvent()` (`lib/repositories/inventory/inventoryEvents.ts:80`). Both idempotent on `client_event_id`, different conventions.
- `tech_serial_numbers` written from: `receiving/serial-attach.ts:170`, `receiving/receive-line.ts:317`, `tech/insertTechSerialForTracking.ts:255`, and `serial-units/[id]/test/route.ts:161`. (A fifth writer, `sync-sheets-to-tech-serials/route.ts`, **never called `upsertSerialUnit()`** and orphaned TSN rows — it was retired and **deleted 2026-06-06** as it is no longer used.)
- `serial_units.origin_tsn_id` ↔ `tech_serial_numbers.serial_unit_id` is a bidirectional link kept in sync only on *some* paths (`syncTsnToSerialUnit()`, `serial-units-queries.ts:454`).

### 2.2 Reusable pattern: **one transactional `recordUnitEvent()`**

> A single helper that, given `(serialUnitId | rawSerial, eventType, context, optional delta)`, upserts the
> unit, writes the `tech_serial_numbers` lineage row + stamps the FK, appends the `inventory_events` row,
> and (when `delta != 0`) appends the `sku_stock_ledger` row with a typed `reason_code_id` — atomically,
> idempotent on `client_event_id`.

Every station write (receive, test, grade, move, allocate, pack, ship, return) becomes a call to this one
façade with a different `eventType`. This is the highest-leverage cleanup: it makes the lifecycle spine the
*only* way to mutate a unit.

### 2.2.1 ⚠️ Transport correction (discovered 2026-06-06)

The original note ("pick the Drizzle `appendInventoryEvent()` as canonical") is **wrong for the transactional
spine**. `lib/drizzle/db.ts` uses `drizzle-orm/neon-http` — a **stateless HTTP** connection that is *separate*
from the pg `pool` (`@neondatabase/serverless` Pool over WebSocket). Every hot path (`receiveLineUnits`,
`pack/ship`, `returns`, `recordDisposition`) is a `pool.connect()` → BEGIN/COMMIT pg transaction, so the
Drizzle repo helpers **cannot co-commit** with them — an event written via Drizzle commits on its own
connection regardless of the surrounding pg transaction.

**Therefore the canonical transactional spine is pg-client based:** `recordInventoryEvent(input, client)` and
the new `attachTechSerial(input, client)`, both accepting a shared pg client. The Drizzle helpers
(`appendInventoryEvent`, `appendLedgerRow`) stay only for **standalone single-row writes** (test/grade/allocate
routes that don't co-commit with other pg writes) and reads. A transport warning is now in
`appendInventoryEvent`'s JSDoc.

### 2.3 Work items

- ~~Pick the Drizzle `appendInventoryEvent()` as canonical~~ — reversed; see 2.2.1. The pg-client
  `recordInventoryEvent(input, client)` is the transactional event primitive.
- **`attachTechSerial()` — DONE (2026-06-06).** New pg-client helper `lib/inventory/tech-serial.ts` (dynamic
  optional columns: `organization_id` bound only when provided, since it is NOT NULL with a session default).
  A grep found the duplication was wider than the plan's "5+" estimate — **~10 raw `INSERT INTO
  tech_serial_numbers` sites**. **6 now route through the helper:** `receiving/serial-attach.ts`,
  `receiving/receive-line.ts`, `serial-units/[id]/test/route.ts`, `tech/insertTechSerialForTracking.ts`,
  `tech/insertTechSerialForSalContext.ts`, `post-multi-sn/route.ts`. Tests in `lib/inventory/tech-serial.test.ts`.
- **`recordUnitEvent()` — DONE (2026-06-06); status-routing REDESIGN DONE (2026-06-29).** pg-client composite
  in `lib/inventory/unit-events.ts` (lock+classify → upsert identity → tech lineage → optional ledger → linked
  event), transaction-scoped (takes a `PoolClient`). **The status mutation now routes through the guarded
  `transition()` state machine** instead of stamping `current_status` via `upsertSerialUnit({target_status})`
  — this resolves the "redesign needed" blocker that previously kept the façade out of the SoT path:
  - **Existing unit + a real status change →** the façade neutralizes the upsert (passes
    `target_status = priorStatus`, a no-op, so the upsert only backfills identity) and calls
    `transition({ to, expectedFrom: priorStatus, stockLedgerId, … }, client, orgId)`, which owns the
    `FOR UPDATE`, the allow-list guard, the `serial_units` UPDATE, and the status-transition `inventory_event`
    — all on the shared client so it co-commits. A rejected transition (404/409) throws → caller rolls back.
  - **Brand-new unit (no prior status) →** there is no valid `from` for `transition()` to guard, so the CREATE
    stays explicit (upsert stamps the birth status; the façade records the create event directly). Existing
    units with NO status change likewise record their event directly. This is documented in the file header.
  - **Uses `transition()`, not `applyTransition()`** — `applyTransition()` always opens its OWN transaction
    (undefined `db` arg) so it cannot co-commit with the façade's caller-owned pg transaction (same transport
    constraint that rules out the Drizzle repos). The engine tap is left to a caller `after()` side-effect.
  - Collaborators (`lookupUnit` / `upsertSerialUnit` / `attachTechSerial` / `recordInventoryEvent` /
    `transition`) are now an injectable `RecordUnitEventDeps`; tests in `lib/inventory/unit-events.test.ts` run
    DB-free via in-memory fakes and assert the captured `transition()` call (unitId / to / eventType /
    expectedFrom / stockLedgerId) plus the non-status composite writes (`npx tsx --test` green, 6/6).
  - **Still not retrofitted into the four hot paths** — that remains the per-path follow-up (each path's
    branching / multi-event / allocation-flip / realtime fan-out must be mapped individually; the single-spine
    façade can't represent them as-is). See the hot-path bullet below.
- **TSN writers (raw-writer pass, 2026-06-29).** Re-examined the 4 "remaining" raw writers. The
  "possible multi-row semantics" note was **wrong** — both sheet syncs are single-row `INSERT`s inside a
  per-row loop. **1 migrated, 3 left (each with a genuine structural blocker the helper can't satisfy):**
  - **`api/sync-sheets/route.ts` (`syncTechSheets`) — DONE (2026-06-29).** Clean drop-in: identical
    columns/values on the same `withTenantTransaction` client; `station_source` falls to the table default
    `'TECH'`, org bound via `input.organizationId` (no extra GUC set). The only delta is the helper
    upper-casing `serial_number` (the table convention every primary writer already follows); these legacy
    rows de-dupe on `created_at`/`shipment_id`/`scan_ref`, never on serial casing, so the normalization is
    inert. Covered by the `tech-serial.test.ts` source guard.
  - `api/receiving/serials/route.ts` (and `lib/neon/tech-logs-queries.ts` `createTechLog`) — **LEFT.** Both
    need `RETURNING` the full row (not just `id`): `receiving/serials` feeds `normalizeRow()` + a synchronous
    `syncTsnToSerialUnit()`, and it relies on the raw INSERT throwing `23505 → 409` ("serial already exists").
    The helper returns only `{ id }` and is `ON CONFLICT DO NOTHING` (silent `null`), which would erase the
    409 conflict semantics. `receiving/serials` also bypasses `serial_units` entirely and should move to
    `attachSerialToLine`/`recordUnitEvent`, not a bare `attachTechSerial`.
  - `api/google-sheets/execute-script/route.ts` (`executeSyncTechSerialNumbers`) — **LEFT.** Writes an
    explicit historical `created_at = testDateTime` (back-fills the original test timestamp). `attachTechSerial`
    has no `created_at` parameter (relies on the DB `NOW()` default); migrating it would silently re-stamp every
    imported row to import-time. A clean swap would need an additive optional `createdAt` on the helper — out of
    scope for this pass (the helper is a 6→7-caller shared primitive; extending it for a single legacy importer
    is its own change).
- ~~Migrate `sync-sheets-to-tech-serials` to route through it~~ — **done by deletion** (2026-06-06).
- **`recordUnitEvent()` hot-path retrofit — re-assessed 2026-06-29, NONE swapped (correct outcome).** Read
  each candidate against the façade. NOTE (post status-routing redesign): the façade now **does** drive status
  through guarded `transition()`, so the old "it bypasses the state machine" objection no longer applies — the
  remaining blocker is purely **shape**: `recordUnitEvent` is a *single-spine* (lock → upsert identity → one
  tech lineage → one ledger → one transition/event) helper, and every hot path here carries branch logic or
  emits multiple events per unit that the single spine cannot represent. The per-path retrofit must be mapped
  individually:
  - `receiveLineUnits` (`lib/receiving/receive-line.ts`) — **LEFT.** Already uses `attachTechSerial`. The
    per-serial logic has three distinct branches (counted-new / over-cap *supplemental* / *re-scan*) plus a
    non-serial remainder loop, per-unit ordinal `client_event_id` suffixes (`:unit-N`,
    `:unit-N-supplemental`, `:unit-N-rescan`), realtime `publishStockLedgerEvent` fan-out, and a trailing
    workflow-stage `NOTE` event. The single upsert→tech→ledger→event spine cannot express any of these without
    changing idempotency keys, dropping the realtime publishes, and collapsing the branch semantics.
  - `returns.ts` (`processReturnsIntake`) — **LEFT.** Looks the unit up `FOR UPDATE` (404 if missing — you
    can't return a unit that never existed), drives the status change through guarded `transition()`
    (`RETURNED`), does the `order_unit_allocations SHIPPED → RETURNED` flip + `resolvePriorOutbound`
    reverse-link, and writes **no** TSN lineage. The façade now routes status through `transition()` too, but it
    would still *upsert* (creating a phantom unit instead of 404-ing a never-shipped serial) and write a TSN
    lineage row this path deliberately omits — and it has no slot for the allocation flip / reverse-link.
  - `rma/authorizations.ts` (`recordDisposition`) — **LEFT.** A `NOTE` event (no status change) + optional
    guarded `transition()` restock (`RETURNED → STOCKED`) + `return_dispositions` insert + placement-policy
    resolve + allocation flip + RMA `order_id` backfill. No upsert, no TSN lineage — not a façade shape.
  - `api/pack/ship/route.ts` — **LEFT.** Existing-unit lookup + allocation validation/update, **three** events
    per unit (`PACKED`/`LABELED`/`SHIPPED`), guarded `transition()` for `SHIPPED`, a `SOLD` ledger decrement,
    plus `packer_logs` + `station_activity_logs` rows. Far beyond the single-event façade.
- **Remaining:** migrate free-text ledger reasons to `reason_code_id`; demote `tech_serial_numbers` to a pure
  audit view over `inventory_events` once all writers funnel through the façade. With the status-routing
  redesign landed, `recordUnitEvent` is now SoT-correct (status via `transition()`); it is best applied first to
  a **new** receiving-style create path, then extended per-path for the four multi-branch hot paths above (each
  needs its own branching/multi-event mapping — a per-path effort, not a bare swap).

---

## 3. Finish the `sku_catalog` identity hub (largest normalization debt)

### 3.1 Findings

`sku_catalog` (`schema.ts:1472`, `UNIQUE(sku)`) is the intended hub, but **~11 tables carry loose
`text('sku')` with no FK**: `items`, `orders` (has unused `sku_catalog_id` too), `receiving_lines`,
`sku_stock`, `fba_fnskus`, `fba_shipment_items`, `bin_contents`, `location_transfers`, `serial_units`,
`sku_stock_ledger`, `stock_alerts`, `cycle_count_lines`. The legacy `sku` table (`schema.ts:1067`) is
retired (insert-blocked) but still an FK target via `tech_serial_numbers.source_sku_id` and
`serial_units.origin_sku_id`.

### 3.2 Reusable pattern: **hub-and-spoke product identity**

> Every table that names a product carries `sku_catalog_id` (FK) as the join key; the `text` sku becomes a
> denormalized convenience column, not the join surface.

### 3.3 Work items (incremental, non-breaking)

- Backfill `sku_catalog_id` on each table by resolving `sku → sku_catalog.id`; add the column where missing (mirror the existing `orders.sku_catalog_id`, `serial_units.sku_catalog_id`, `fba_fnskus.sku_catalog_id`).
- Add FKs as `NOT VALID` first, then `VALIDATE CONSTRAINT` after backfill (zero-downtime).
- Start writers stamping `sku_catalog_id` going forward (the receiving pipeline already enriches it lazily via `enrichSerialUnitCatalog()` — generalize that).
- Keep `text` sku for display/denorm; never JOIN on it again.

---

## 4. Generalize the polymorphic "attach-to-any-entity" pattern

### 4.1 Findings

`work_assignments`, `photos`, and `entity_notes` all use `(entity_type, entity_id)`. Integrity is enforced
by **per-parent BEFORE DELETE triggers** (e.g. `trg_cancel_wa_on_order_delete`,
`trg_delete_photos_on_packer_log_delete`) — hand-rolled per parent, app layer does no validation.

### 4.2 Reusable pattern: **one polymorphic-attachment convention + generated triggers**

> A documented `entity_type` registry + a trigger generator so adding "notes/photos/assignments on entity X"
> is a one-liner, and an app-layer `assertEntityExists(type, id)` guard shared by all writers.

### 4.3 Work items

- Centralize the `entity_type` enum/registry (today `entity_notes.entity_type` is free text).
- Write a `makePolymorphicCascade(parentTable, childTable)` SQL macro so new attachments get integrity for free.
- Extend the pattern to `serial_units` and `rma_authorizations` (notes/photos on a unit and on an RMA are obvious next needs).

---

## 5. Unify external-ID mapping (Zoho / eBay / platform ids)

### 5.1 Findings

`zoho_*` id columns are sprinkled ad-hoc across ≥9 tables (`receiving.zoho_purchase_receive_id`,
`receiving_lines.zoho_item_id/zoho_purchaseorder_id/...`, `serial_units.zoho_item_id`,
`customers.zoho_contact_id`, etc.) with inconsistent nullability/uniqueness and **no FK to `items`**.
Contrast the **clean** `sku_platform_ids` table (`schema.ts:1487`): FK to hub + `platform` discriminator +
normalized one-row-per-mapping.

### 5.2 Reusable pattern: **the `sku_platform_ids` shape, generalized**

> A single `external_id_mappings(system, entity_type, entity_id, external_id, external_ref, synced_at)`
> table (or per-domain tables following the `sku_platform_ids` shape) is the only place external ids live;
> local tables stop carrying loose `zoho_*` columns.

### 5.3 Work items

- Introduce `external_id_mappings`; backfill from existing `zoho_*` columns.
- Route all Zoho sync lookups through one helper instead of direct column reads.
- Phase out scattered `zoho_*` columns table-by-table (keep on `items`/`zoho_locations` as the canonical mirrors).

---

## 6. Convert location references from free text to FK

### 6.1 Findings

`locations`/`bin_contents` model bins correctly (`bin_contents.location_id` FK, `schema.ts:1572`), but
`serial_units.current_location` is **free text** (`schema.ts:1611`), and `location_transfers.from/to_location`
are text. Renaming a bin can silently orphan a unit's location.

### 6.2 Work items

- Add `serial_units.current_location_id` (FK `locations.id`, nullable); backfill by name match; keep text as denorm.
- Make putaway/move writers stamp the FK (the `inventory_events.bin_id`/`prev_bin_id` columns already do this — `serial_units` just needs to mirror it).
- Leave `location_transfers` text as-is (audit log; tolerates deleted-bin recovery).

---

## 7. Finish the typed-reason-code migration

### 7.1 Findings

`reason_codes` (`schema.ts:1698`) + `sku_stock_ledger.reason_code_id` exist and are used by
`transfers` and `locations` routes, but ~60% of ledger writes (`pack/ship`, `receiving/mark-received`,
`sku-stock`, `cycle-count`) still write **free-text** `reason`. Financial categorization
(shrinkage/sale/return) depends on the typed code.

### 7.2 Work items

- Map every existing free-text reason string to a `reason_codes.code`; seed missing codes.
- Make `appendLedgerRow()` require `reasonCodeId` (keep `reason` as denorm label).
- Migrate the remaining ~4 raw-SQL ledger writers to `appendLedgerRow()` (folds into §2).

---

## 8. Standardize idempotency and the repository layer

### 8.1 Findings

- **Idempotency** is mature at the event level (`client_event_id UNIQUE` everywhere) but the response-level wrapper (`withIdempotentResponse()`, `lib/api-idempotency.ts`) is used in only ~2 routes. Mutation routes are inconsistent.
- **Repository layer** (`lib/repositories/inventory/*`) is clean but ~20% adopted — new `serial-units/[id]/*` routes use it; receiving/pack/tech still use raw `neon-client` queries. The migration is explicitly staged in the inventory-system upgrade notes.

### 8.2 Work items

- Adopt a "every mutating route either takes `client_event_id` or wraps with `withIdempotentResponse()`" rule; add an `api-route-reviewer` checklist item.
- Continue the staged repository migration (receiving putaway → packing SHIPPED) so all stock/event writes funnel through §2's façade.

---

## 9. Consolidate audit + scan-resolution duplication (lower priority)

- **Audit:** four systems coexist (`audit_logs` normalized + 69 routes, `auth_audit`, `station_activity_logs`, and ad-hoc JSONB `receiving_lines.disposition_audit` / `orders.status_history`). Normalize the JSONB trails into `audit_logs` rows; keep the other three (they serve distinct purposes). Aligns with `docs/audit-trail-anchor-plan.md`.
- **Scan resolution:** `scan-resolver.ts` is the canonical classifier, but `barcode-routing.ts` re-defines GS1 AI regexes and `testing/resolve-testing-scan.ts` does ad-hoc API matching. Make `scan-resolver.ts` the single source; have the others compose it. (Ties to the `[[barcode-routing]]` GS1 work.)

---

## 10. Phased roadmap

| Phase | Theme | Items | Why first |
|---|---|---|---|
| **P1 — Close the flagship loop** | Reverse-link on inbound | §1 | Directly delivers the shipped↔returned pairing; small, high-visibility, reuses existing lookup helpers |
| **P2 — One write façade** | `recordUnitEvent()` | §2, §7, §8.2 | Removes the largest fragmentation; everything downstream gets cleaner; fixes orphaned TSN rows |
| **P3 — Identity hubs** | sku_catalog FKs, external-id table, location FK | §3, §5, §6 | Makes JOINs safe; unblocks reporting; non-breaking backfills |
| **P4 — Cross-cutting polish** | polymorphic attachments, audit/ scan consolidation | §4, §9 | Quality + future feature velocity |

**Sequencing rule:** P1 and P2 are independent and can run in parallel. P3 backfills should land before
P2's façade *requires* `sku_catalog_id`/`reason_code_id` so writers never block on missing references.

---

## 11. Quick reference — canonical helpers to reuse (don't re-implement)

| Need | Use | Location |
|---|---|---|
| Record/realize a serial's existence | `upsertSerialUnit()` | `lib/neon/serial-units-queries.ts:268` |
| Find where a serial shipped (for returns) | `findShippedOrderForSerialUnit()` / `findShippedOrderByTsnSerial()` | `serial-units-queries.ts:154,191` |
| Append a lifecycle event (idempotent) | `appendInventoryEvent()` | `lib/repositories/inventory/inventoryEvents.ts:80` |
| Move quantity | `appendLedgerRow()` | `lib/repositories/inventory/stockLedger.ts:64` |
| Receive units (composite) | `receiveLineUnits()` | `lib/receiving/receive-line.ts:184` |
| Allocate / release a unit to an order | `allocate()` / `release()` | `lib/repositories/inventory/allocations.ts` |
| Entity-level audit | `recordAudit()` | `lib/audit-logs.ts` |
| Response idempotency | `withIdempotentResponse()` | `lib/api-idempotency.ts` |
| Classify a raw scan | `classifyInput()` / `parseScannedUrl()` | `lib/scan-resolver.ts` |

---

## Session 2026-06-28 — completion pass

No code changes — doc-only status reconciliation. Verified against the codebase:

- §1 Phase 1 flagship loop confirmed shipped (`resolvePriorOutbound` called in `returns.ts` + `rma/authorizations.ts`; `2026-06-06_close_return_loop.sql`; in-tx `SHIPPED → RETURNED`); §1.4 flipped from to-do to DONE.
- §2 helpers `attachTechSerial` + `recordUnitEvent` confirmed built + unit-tested.
- The `recordUnitEvent` hot-path retrofit was **deliberately NOT done** — it is a large, medium-risk change across pack/ship/returns and needs full behavioral testing first.

## Session 2026-06-29 — §2 raw-writer + façade-retrofit pass

Read both sides of every candidate (the helpers AND each call site) before touching anything; preserved
existing behavior exactly. Net: **one safe migration shipped, six sites left with documented structural
reasons.**

- **SHIPPED — `api/sync-sheets/route.ts` (`syncTechSheets`)** routed onto `attachTechSerial(input, client)`.
  Byte-identical writes (same columns/values, same tenant txn client, org bound explicitly, `station_source`
  → default `'TECH'`) except the helper upper-cases `serial_number` — the documented table convention; dedup
  keys on `created_at`/`shipment_id`/`scan_ref`, not casing, so it's inert. Source guard added in
  `tech-serial.test.ts`; `npx tsx --test` green (13/13).
- **LEFT (PART 1) — `api/receiving/serials`** (needs full-row `RETURNING` + `23505 → 409` throw-on-conflict;
  helper is `RETURNING id` + `ON CONFLICT DO NOTHING`) and **`api/google-sheets/execute-script`** (writes an
  explicit historical `created_at`; helper has no such param). See §2.3 for detail.
- **LEFT (PART 2) — all four `recordUnitEvent` hot-path candidates** (`receiveLineUnits`, `returns.ts`,
  `rma/authorizations.ts` `recordDisposition`, `api/pack/ship`). At the time, the façade bypassed the
  `transition()` state machine — now superseded (see the 2026-06-29 redesign below). The residual blocker is
  shape: every one carries branch logic (supplemental/re-scan, multi-event pack→label→ship, allocation flips,
  restock, placement) the single-spine façade cannot represent. Swapping any would change writes, idempotency
  keys, or realtime fan-out. See §2.3.

## Session 2026-06-29 (later) — `recordUnitEvent` status-routing redesign

- **`recordUnitEvent` now drives status through guarded `transition()`** (was `upsertSerialUnit({target_status})`),
  resolving the "redesign needed" blocker. Existing-unit status change → neutralized upsert + `transition({ to,
  expectedFrom: priorStatus, stockLedgerId })` on the shared client (co-commit); brand-new-unit create stays
  explicit (no from-state to guard) + records its event directly. Uses `transition()` not `applyTransition()`
  (the latter opens its own tx and can't co-commit). Collaborators injected as `RecordUnitEventDeps`; DB-free
  fakes test asserts the captured transition call + composite writes (`npx tsx --test` green, 6/6); tsc clean on
  touched files. Façade remains **unused in production** (only its own test imports it) — this reshapes an
  as-yet-unwired façade to be SoT-correct/ready, not a live behavior change. Per-hot-path retrofit still the
  follow-up. See §2.3 for the full write-up.

## Remaining work — handoff (2026-06-29)

- **[CODE]** (small) Migrate `api/google-sheets/execute-script` (`executeSyncTechSerialNumbers`) once
  `attachTechSerial` grows an additive optional `createdAt` (mirror the existing `fnskuLogId` conditional
  column + add a test) — only blocker is the historical-timestamp back-fill.
- **[CODE]** (small / careful) Migrate `api/receiving/serials` + `lib/neon/tech-logs-queries.ts`
  (`createTechLog`) only after deciding how to preserve their full-row `RETURNING` and conflict semantics —
  e.g. an `attachSerialToLine`/`recordUnitEvent` move that also writes `serial_units`, or a helper variant that
  returns the row and surfaces conflicts. Do **not** bare-swap onto `attachTechSerial` (loses the 409).
- **[CODE]** (large / medium-risk, may be a NON-GOAL) `recordUnitEvent` now drives status via `transition()`
  (status-routing redesign DONE 2026-06-29), so it is SoT-correct — but it is still a *single-spine* shape and
  the four hot paths emit multiple events / branch per unit. Each remaining retrofit must extend the façade
  (multi-event / branch support) or be mapped path-by-path; **needs run-the-app integration verification before
  any hot path is switched** (allocation flips, realtime fan-out, idempotency-key suffixes). Prefer applying
  `recordUnitEvent` to a fresh receiving-style create path first.
- **[MIGRATION-DEPLOY-COUPLED]** §3 `sku_catalog` FK backfill; §5 `external_id_mappings`; §6 `serial_units.current_location_id`; §7 `reason_code_id` requirement. Each is backfill-then-validate and must land in the same deploy as its writers.
- **[DESIGN-DECISION]** §4 polymorphic-attachment registry + generated-trigger macro.
- **[DEFERRED-BY-DESIGN]** §8 idempotency/repository-layer standardization and §9 audit + scan-resolution consolidation — keep as roadmap, no action this pass.
</content>
</invoke>
