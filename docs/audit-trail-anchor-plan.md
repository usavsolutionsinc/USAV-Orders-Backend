# Audit Trail Anchoring — Unification Plan

**Status:** Phase 1 implemented (2026-06-04). See "Implementation log" below.
**Decision:** Anchor the unified audit timeline on **`receiving_lines.id` (the receiving line), grouped under the Purchase Order.** "Line under PO."
**Date:** 2026-06-04

---

## Implementation log (2026-06-04)

**Shipped — Phase 1 core (the reported bug):** the Tech/testing audit timeline now
reads the unified `inventory_events` spine, so it shows **receiving AND testing**
events together instead of only the shipment-scoped tech rows.

Files changed:
- `src/lib/audit-log/tech-aggregator.ts` — `getTechSessionDetail`:
  - Anchor resolution is now flexible: resolves the `session` param as a **tracking
    number** (existing, → `shipment_id`) OR, when that fails, as a **Zoho PO id**
    (→ its `receiving_lines`). This is the "Line under PO" anchor.
  - Collects the session's `receiving_line_id`s and `serial_unit_id`s (from
    `tech_serial_numbers` + `serial_units.origin_receiving_line_id`).
  - **New event source:** `inventory_events WHERE receiving_line_id = ANY(...) OR
    serial_unit_id = ANY(...)` → surfaces `RECEIVED`, `TEST_START`, `TEST_PASS`,
    `TEST_FAIL`, `PUTAWAY`, … with prev→next status and verdict payload.
  - **De-dupe (Q3 = yes):** the synthetic `SERIAL_TESTED` row is suppressed for any
    serial that already has a first-class `TEST_*` lifecycle event, so verdicts
    aren't shown twice. `inventory_events` is the source of truth for testing.
  - `sku_summary` is now stitched from the serials + lifecycle events (anchor-agnostic),
    replacing the shipment-only query.
- `src/components/audit-log/AuditLogTechClient.tsx` — added `inventory_event` to the
  `TechEvent` source union and added tones for `RECEIVED / TEST_START / TEST_PASS /
  TEST_FAIL / PUTAWAY / MOVED` (mirrors the receiving timeline).
- `src/lib/audit-log/sku-aggregator.ts` — drive-by bug fix: `getSkuDetail` read a
  non-existent `ie.kind` column (the column is `event_type`); the receiving section of
  the SKU audit view would have thrown. Fixed to `ie.event_type`.

**Also shipped — Tech picker reachability:** `listTechSessions` now UNIONs
shipment-anchored sessions (keyed by tracking) with **PO-anchored testing sessions**
(`testing_results → receiving_lines`, keyed by `zoho_purchaseorder_id`), so items
tested-from-receiving with no tracking now appear in the Tech sidebar picker.
`TechSessionSummary` gained a `session_key` (the `?session=` value) distinct from the
display `tracking` label; `AuditLogSidebarPanel`'s `TechSessionPicker` keys on it.
`sku_summary` / `serial_count` are computed via scalar subqueries to avoid join fan-out.

Validation: `tsc --noEmit` clean (0 errors). **Runtime-verified against the DB:**
`EXPLAIN` passes for both new queries; a live `listTechSessions` run returns mixed
tracking- and PO-anchored sessions; and resolving PO `5623409000002522119` through the
detail path surfaced `RECEIVED ×2`, `TEST_PASS` (RECEIVED→TESTED), `LABELED ×3` — i.e.
receiving + testing now appear in one timeline.

**Note — the Receiving PO view already is the unified timeline.** `getReceivingAuditPO`
reads `inventory_events` by `receiving_line_id`, and `AuditLogReceivingClient` already
renders `TEST_*` tones. So the canonical "line under PO" timeline (receiving + testing
in one place) is the **Receiving** audit section, per PO, today.

**Shipped — Phase 0 (shared reader):** extracted `src/lib/audit-log/inventory-spine.ts`
(`readInventorySpine({ lineIds, serialUnitIds, cartonIds, staffId, order, limit })`) — one
batched `inventory_events` read with staff + serial_units joins, keyed on any id set.
- `tech-aggregator.ts` now calls it (replaced the inline query).
- `receiving-aggregator.ts` now calls it for its lifecycle source (kept its own
  staff/bin/serial map enrichment; the reader's WHERE/order/limit are identical to the
  old inline query, so the row set is unchanged — behavior-preserving by construction).
- The SKU aggregator was left as-is: it filters by `sku` (not id sets) and joins
  `receiving_lines` for `item_name`, so it doesn't fit the id-keyed reader.
- Verified through the real TS modules against the DB: tech (session=PO) and receiving
  (PO) both return the same events as before — `TEST_PASS 069234P62022378AE` present in
  each.

**Shipped — Phase 3 (write-path consistency):** the testing verdict route
(`src/app/api/serial-units/[id]/test/route.ts`) now writes a first-class `audit_logs`
row via `recordAudit` — the verdict route was the only state-mutating route with no
audit-ledger entry.
- New canonical verbs in `src/lib/audit-logs.ts`: `TECH_QC_PASS` / `TECH_QC_RETEST` /
  `TECH_QC_FAIL` (`tech.qc.pass|retest|fail`).
- Tagged `entity_type = serial_unit` (mirrors `receiving.scan-serial`), with
  before→after status and `metadata.{verdict, receiving_line_id, serial_number, sku,
  inventory_event_id}`. **Deliberately NOT `receiving_line`** (the plan's first guess):
  the PO and tech timelines already render the verdict from `inventory_events`, so a
  `receiving_line` audit row would double-render. The `serial_unit` row is the
  compliance/mutation-ledger record; it's archival (no current timeline reads
  `serial_unit` audit rows), by design, to avoid duplication.
- **Bug fix (Staff audit view was broken):** `staff-aggregator.ts` read a non-existent
  `ie.kind` column — the Staff section's receiving query threw, so the whole Staff feed
  errored. Fixed to `ie.event_type`. Net effect: a tester's `TEST_*` verdicts now appear
  in their Staff audit feed (via `inventory_events`, actor-scoped) — verified 43 TEST_*
  events surfaced for staff #1.
- Verified: `createAuditLog` write validated in a rolled-back transaction (id minted,
  `action=tech.qc.pass`, `entity_type=serial_unit`, before/after correct; nothing
  persisted).

**Shipped — Phase 4 (Packing onto the spine):** `getPackingTrackingDetail`
(`packing-aggregator.ts`) now surfaces the outbound lifecycle for units in the shipment.
- Resolves units via `order_unit_allocations → orders.shipment_id` (inventory_events has
  no shipment column), then `readInventorySpine({ serialUnitIds, eventTypes })` filtered
  to the outbound set (`ALLOCATED/RELEASED/PICKED/PACKED/LABELED/STAGED/SHIPPED`) so the
  packing view stays scoped to fulfillment, not a unit's full receiving/testing history.
- Added an `eventTypes?: string[]` filter to `readInventorySpine` (generic).
- Client (`AuditLogPackingClient`) got the `inventory_event` source + tones for the
  outbound kinds.
- **Bug fix (Packing detail view was broken):** the aggregator selected
  `pl.packer_photos_url`, a column that does not exist on `packer_logs` — so
  `getPackingTrackingDetail` threw on every call. Pack photos actually live in the shared
  `photos` table (`entity_type='PACKER_LOG'`); rewired to read from there (same pattern
  as receiving). The packing detail view now works at all.
- Verified: packing detail for `1Z1A375J0335482484` returns `PACK_COMPLETED` (×2 sources)
  + `inventory_event:ALLOCATED` (serial 019158900240341AC, sku 00001-BK, order 2572).

**Shipped — Phase 2 (shared renderer):** extracted
`src/components/audit-log/AuditEventCard.tsx` — one `AuditEventCard` + `AuditCenterMessage`
+ single `KIND_TONE` vocabulary + `kindLabel`/`fmtTime`. The Tech and Packing clients now
use it (their near-identical local `EventRow`/`CenterMessage`/tone maps were deleted).
The card reads serial/sku from top-level **or** `detail` (so Packing spine rows show them
too). The **Receiving** client keeps its own richer renderer (per-kind icons, workflow
badges, carton/line grouping) — intentionally not folded in (high risk, no benefit).
`tsc` clean; no stale references.

**Remaining (optional, not blocking):**
- Product decisions: Q2 (where line-less ADMIN label-print rows surface) / Q4 (retire the
  tracking anchor, or keep as fallback).
- Cosmetic: an item tested via tracking AND present under a PO can appear as two sessions
  (one per anchor). Acceptable; de-dupe later if it bothers operators.

**Bonus bugs fixed along the way** (all the same class — wrong column name silently
breaking an audit section): `sku-aggregator` + `staff-aggregator` read `ie.kind`
(→ `ie.event_type`); `packing-aggregator` read `pl.packer_photos_url` (→ `photos` table).
The SKU, Staff, and Packing detail views were each throwing before these fixes.

---

## 1. The problem in one sentence

When a unit is scanned at **Receiving** and then tested at **Tech**, the testing events do **not** show up in the Tech audit view — because the two audit views are anchored on **two different keys**, and the testing write-path doesn't populate the key the Tech view queries on.

---

## 2. Current state (deep dive)

### 2.1 There are two competing anchors

| View | Aggregator | Anchor key | Event sources it reads |
|------|-----------|-----------|------------------------|
| **Receiving** | `src/lib/audit-log/receiving-aggregator.ts` | `receiving_lines.zoho_purchaseorder_id` (**PO**), rolled up from lines | `receiving`, `receiving_lines`, `disposition_audit`, **`inventory_events` (by `receiving_line_id` / `receiving_id`)**, `audit_logs`, `photos`, `serial_units` |
| **Tech / Testing** | `src/lib/audit-log/tech-aggregator.ts` | `shipping_tracking_numbers` via **`tech_serial_numbers.shipment_id`** (the **tracking number**) | `tech_serial_numbers (WHERE shipment_id IS NOT NULL)`, `station_activity_logs` (by `tech_serial_number_id`), `audit_logs (entity_type='TECH_SERIAL')` |

The Packing, SKU, and Staff views add yet more anchors (tracking, SKU, staffId).

### 2.2 The data already has a single through-line: `receiving_line_id`

The migration `2026-03-31_tsn_add_station_source_and_receiving_line.sql` deliberately added `receiving_line_id` to `tech_serial_numbers`. As of today the receiving line id is present on **every** event-bearing table across both domains:

```
receiving_lines.id
  ← inventory_events.receiving_line_id      (RECEIVED, TEST_START, TEST_PASS, TEST_FAIL, PUTAWAY, …)
  ← tech_serial_numbers.receiving_line_id   (station_source = RECEIVING and TECH)
  ← testing_results.receiving_line_id
  ← serial_units.origin_receiving_line_id
  ← audit_logs.metadata.receiving_line_id   (set by the receiving scan-serial decorator)
```

And `receiving_lines` already carries `zoho_purchaseorder_id`, so **line → PO** rollup is free.

`inventory_events` is effectively **already the unified event spine**: every station writes to it with `(receiving_line_id, serial_unit_id, sku, station, event_type, actor_staff_id, occurred_at)`.

### 2.3 The exact bug, with file references

**Testing write-path** (`src/app/api/serial-units/[id]/test/route.ts`):
- Writes `inventory_events` with `event_type ∈ {TEST_PASS, TEST_FAIL, TEST_START}` and `receiving_line_id = lineId` (`route.ts:171-183`). ✅ carries the line.
- Writes `tech_serial_numbers` with `station_source='TECH'`, `receiving_line_id=lineId`, but **`shipment_id` is left NULL** (`route.ts:148-162`). ❌ no tracking.
- Writes `testing_results` with `receiving_line_id` (`route.ts:190-199`). ✅ carries the line.

**Tech aggregator** (`src/lib/audit-log/tech-aggregator.ts`):
- `listTechSessions` starts with `where = ['tsn.shipment_id IS NOT NULL']` and groups by tracking (`tech-aggregator.ts:67, 118`).
- `getTechSessionDetail` resolves a tracking string → `shipment_id`, then queries `tech_serial_numbers WHERE shipment_id = $1` (`tech-aggregator.ts:155-182`).
- It **never reads `inventory_events`** and **never queries by `receiving_line_id`.**

➡️ **Every testing verdict that originated from receiving has `shipment_id = NULL`, so it is filtered out before the Tech view can render it.** The Tech view only shows rows that happen to have a tracking number attached (e.g. FBA/standalone tech sessions), which is why it "only shows receiving."

**Corroborating fact:** the Receiving PO view already renders test events. `AuditLogReceivingClient.tsx:145-147` has tones for `TEST_START / TEST_PASS / TEST_FAIL`, and the receiving aggregator pulls them from `inventory_events` by `receiving_line_id` (`receiving-aggregator.ts:379-386`). So the PO timeline is already ~90% of the unified view we want.

---

## 3. Why "Line under PO" is the right anchor

| Candidate anchor | Verdict | Reason |
|------------------|---------|--------|
| **`receiving_line_id`, grouped under PO** | ✅ **Chosen** | The only key already present on every cross-domain event table. Right altitude: one SKU within a carton/PO. Non-serialized lines still get a timeline. PO rollup is free via `zoho_purchaseorder_id`. |
| Tracking / `shipment_id` | ❌ | Testing verdicts never set it; one tracking spans many POs/SKUs; one PO spans many cartons/trackings; returns and manual items often have no tracking. This *is* the current bug. |
| Serial unit | ❌ too granular | Not every line has serials; non-serialized lines would vanish. Good as a *sub-grouping* inside a line, not the anchor. |
| PO alone | ❌ too coarse | Loses "which line/SKU was tested." Keep PO as the **parent group**, not the event key. |

**Anchor contract going forward:**
- **Canonical event key:** `inventory_events.receiving_line_id` (plus `serial_unit_id` for unit-level detail).
- **Top-level grouping:** `receiving_lines.zoho_purchaseorder_id` (PO).
- **Presentation:** PO page → list of lines → each line shows its full interleaved receiving → testing → putaway → pack → ship timeline.

---

## 4. Target architecture

```
PO  (zoho_purchaseorder_id)
 └─ Line  (receiving_lines.id)            ← THE ANCHOR
     ├─ timeline (chronological, all stations):
     │    RECEIVED → CARTON_UNBOXED → DISPOSITION_CHANGED →
     │    TEST_START → TEST_FAIL/TEST_PASS → PUTAWAY → PACKED → SHIPPED
     └─ per-serial sub-rows (serial_units under origin_receiving_line_id)
```

The receiving aggregator (`getReceivingAuditPO`) is the closest existing implementation and becomes the **canonical unified reader**. The Tech view is re-pointed to it (or to a shared line-scoped reader) instead of its tracking-anchored query.

---

## 5. Implementation plan (phased — for review, not yet executed)

### Phase 0 — Shared line-scoped reader (foundation)
Create `getLineAuditTimeline(receivingLineId)` (or generalize the inner event-stitching of `getReceivingAuditPO` into a reusable function) in `src/lib/audit-log/`. It returns the unified `AuditEvent[]` for one line by reading the `inventory_events` spine + `testing_results` + `tech_serial_numbers` + `audit_logs` + disposition history, all filtered by `receiving_line_id`.
- This is a pure read; no schema change.
- `getReceivingAuditPO` is refactored to call it per line (behavior-preserving).

### Phase 1 — Fix the Tech view (unblocks the reported bug)
Re-point `tech-aggregator.ts` so a "session" resolves to a **receiving line / PO**, not a tracking number:
- `getTechSessionDetail` should, when given a line id (or PO), return the same unified timeline filtered to testing-relevant events (or the full line timeline — see Open Question Q3).
- Drop the hard `tsn.shipment_id IS NOT NULL` gate; add `inventory_events WHERE receiving_line_id = …` as an event source.
- Keep tracking-resolution as a **fallback** for genuinely standalone tech sessions (FBA / manual label prints with no receiving line — see §6).
- The sidebar "tech sessions" list (`listTechSessions`) re-keys to recently-tested **lines/POs** instead of trackings.

### Phase 2 — Presentation: "Line under PO"
- Promote the receiving PO timeline (`AuditLogReceivingClient`) to be the canonical unified view, with lines as the primary grouping and each line expandable to its cross-station timeline.
- `AuditLogTechClient` either redirects to the PO view anchored on the line, or renders the shared line timeline component. Avoid two divergent renderers.

### Phase 3 — Write-path consistency (close the gaps that made this fragile)
- Make the testing verdict path also emit a first-class `audit_logs` row (today it relies only on `inventory_events`; `route.ts` has no audit decorator). Tag it with `entity_type='receiving_line'`, `entity_id=lineId`, and `metadata.receiving_line_id` so it joins on the canonical anchor.
- Audit every station write-path to ensure `receiving_line_id` is populated wherever a line context exists (label-print/admin rows legitimately have none — keep those serial/PO-less).

### Phase 4 — Converge SKU / Staff / Packing views (optional, later)
Have these read the same `inventory_events` spine and link back to the line/PO anchor, so cross-cutting views stay consistent with the line-under-PO source of truth.

---

## 6. Edge cases & data-integrity gaps to handle

1. **Orphan serials (no parent line).** `route.ts:146` skips `tech_serial_numbers` when `lineId == null`; the verdict still lands in `inventory_events` (serial-only). The unified reader must support a **serial-only / line-less** bucket so these aren't lost.
2. **Manual / ADMIN label prints** (`/api/post-multi-sn`) write `tech_serial_numbers` with `source_sku_id` + `context_station_activity_log_id` but **no** `receiving_line_id` and **no** `shipment_id`. These have no PO/line anchor by design — decide whether they appear under a SKU view only, or get a synthetic "unattached" group.
3. **Standalone / FBA tech sessions** that legitimately have a tracking but no receiving line — keep the tracking-resolution fallback for these.
4. **Returns** often arrive with no tracking and no PO line until matched — confirm they still anchor once a line exists.
5. **One serial, multiple lines / re-tests** — `ux_tsn_receiving_line_serial` is partial on `receiving_line_id IS NOT NULL`; idempotency is per (line, serial). The timeline must tolerate repeated `TEST_*` events on the same line.

---

## 7. Backfill / migration considerations

- **No new column is strictly required** for the read-side fix — the anchor already exists everywhere.
- Optional historical backfill: for legacy `tech_serial_numbers` rows that have `shipment_id` but no `receiving_line_id`, attempt to derive the line via `serial_units.origin_receiving_line_id` (join on normalized serial). Document any rows that can't be resolved.
- If Phase 3 adds `audit_logs` rows for testing, no backfill is needed (forward-only); historical testing events remain readable via `inventory_events`.

---

## 8. Risks

- **Two renderers drifting** — mitigate by extracting a single shared line-timeline component/reader (Phase 0/2).
- **Query cost** — anchoring on `receiving_line_id` (indexed FK) is cheaper than the current tracking resolution; verify indexes exist on `inventory_events.receiving_line_id`, `tech_serial_numbers.receiving_line_id`, `testing_results.receiving_line_id`. (Neon CU-hours: prefer one `ANY($lineIds)` batched query per source over per-line loops.)
- **Behavioral change for FBA/standalone tech sessions** that relied on the tracking anchor — preserve via fallback.

---

## 9. Verification plan

1. Reproduce: receive a unit → test it (PASS/FAIL) → open the **Tech** audit view → confirm the `TEST_*` event now appears alongside the receiving events.
2. Confirm the **PO** view shows the same line with the full interleaved timeline (already partially working).
3. Confirm orphan-serial verdicts (line-less) still render in a sensible bucket.
4. Confirm FBA/standalone tech sessions still resolve via the tracking fallback.
5. Confirm no duplicate timeline entries (the `inventory_events` spine vs `tech_serial_numbers` should de-dupe — both carry the same `receiving_line_id`; pick one as primary for `TEST_*` to avoid double rows).

---

## 10. Open questions for the user

- **Q1.** Should the Tech audit view show the *full* line timeline (receiving + testing + pack + ship) or only the testing slice with a link to the full PO view?
- **Q2.** For manual/ADMIN label-print rows with no line and no PO, where should they surface — SKU view only, or a synthetic "unattached" group in the unified view?
- **Q3.** Should the `inventory_events` spine be the **single** source for `TEST_*` events (with `tech_serial_numbers` used only for detail enrichment), to avoid double-rendering? (Recommended: yes.)
- **Q4.** Keep the tracking-anchored Tech session concept as a fallback, or fully retire it in favor of line/PO?
