# Receiving-scans → STN link plan (Phase 6 detail)

Status: step 1 implemented 2026-06-08 · Owner: receiving
Parent: [receiving-triage-streamline-plan.md](./receiving-triage-streamline-plan.md) §6

Detailed spec for the decision: **every dock scan links to a canonical
`shipping_tracking_numbers` (STN) row by id — creating that STN row if it
doesn't exist yet — so `receiving_scans` references tracking by `shipment_id`
instead of carrying its own copy of the tracking string.** This is the concrete
mechanism that lets §6 eventually drop the legacy TEXT columns.

---

## 1. Why this shape

`receiving_scans` is the **dock-event fact** ("operator X scanned carton Y at
time T") — nothing else records it, and the "delivered · needs scan" state is
literally defined by its absence. So it stays an append-only event table. What
changes: it stops storing a denormalized `tracking_number`/`carrier` and instead
points at the one canonical tracking row.

For that to work, **the STN row must exist at scan time**. Rather than hope a
carrier webhook already created it, the scan path itself does a get-or-create.
STN is then the single home for every scanned carrier tracking number.

## 2. The flow (implemented in `lookup-po` `recordScan` → `linkScanToStn`)

```
operator scans tracking T  →  recordScan(receivingId, T, carrier, staff, source)
  1. INSERT receiving_scans (… tracking_number=T …)        -- the event, unchanged
  2. linkScanToStn(scanId, receivingId, T, source):        -- gated, best-effort
     a. stn = registerShipmentPermissive({ trackingNumber: T })   -- get-or-create
     b. if stn == null  → non-carrier / SKU-format / sub-8 → leave shipment_id NULL
     c. UPDATE receiving_scans  SET shipment_id = stn.id  WHERE id = scanId
     d. UPDATE receiving        SET shipment_id = stn.id  WHERE id = receivingId
                                                          AND shipment_id IS NULL
```

- **(a) get-or-create** — `registerShipmentPermissive` is an idempotent upsert
  keyed on the normalized tracking#, so concurrent/repeat scans converge on one
  STN row (carrier auto-detected, else `carrier='UNKNOWN'` = the CARRIER_MISMATCH
  signal).
- **(d) carton adoption** — keeps `receiving.shipment_id` authoritative, which is
  what the Phase 3 line-stamp (`receiving_lines.shipment_id`) and the
  delivered-unscanned enrichment build on. One scan → carton, lines, and the
  scan event all point at the same STN row.

### Gating + safety

- Behind `RECEIVING_UNIFIED_INBOUND` (default OFF). Until the migration is applied
  and the flag flipped, `linkScanToStn` is a no-op and never references the new
  column — an unapplied migration cannot error a scan.
- Best-effort: any failure (transient STN write, missing column) is caught and
  logged; the scan always succeeds. The dock event is never lost.

## 3. Schema

`receiving_scans.shipment_id BIGINT NULL REFERENCES shipping_tracking_numbers(id)
ON DELETE SET NULL` — migration `src/lib/migrations/2026-06-08_stn_consolidation.sql`
(additive, idempotent, indexed `WHERE shipment_id IS NOT NULL`).

**Nullable on purpose:** a scan-before-STN edge (none here, since we create it
inline) or a non-carrier code (SKU-format scan) legitimately has no STN row. The
dock event still records with `shipment_id NULL`.

## 4. Dedup interaction

`recordScan` upserts on `(tracking_number, receiving_id)`. While the legacy
`tracking_number` column still exists (pre-S6) that conflict key is unchanged, so
re-scans still dedup exactly as today; `linkScanToStn` just (re)asserts the STN
link. Post-S6 (column dropped) the conflict key moves to
`(shipment_id, receiving_id)` — specified in §6.3 S5/S6, not done yet.

## 5. Backfill (historical scans)

`scripts/backfill-receiving-scans-shipment-id.sql` — pass 1 from
`receiving.shipment_id`, pass 2 from the scan's own `tracking_number → STN`
(normalized, last-8). Run once after the migration; idempotent. Rows that still
resolve to no STN are the genuine non-carrier residual.

## 6. Verification

`scripts/verify-stn-consolidation.sql` (read-only). Gate metrics:
- Q1/Q2 — `shipment_id` coverage and zero "unlinked but STN exists" misses.
- Q5/Q5b — every legacy tracking string is recoverable from `shipment_id → STN`
  (drop-safety).

## 7. Rollout

```
1. apply 2026-06-08_inbound_handling_unit.sql        (Phase 3 cols)
2. apply 2026-06-08_stn_consolidation.sql            (this: receiving_scans.shipment_id)
3. run   backfill-inbound-handling-unit.sql
   run   backfill-receiving-scans-shipment-id.sql
4. set   RECEIVING_UNIFIED_INBOUND=true              (get-or-create + link goes live)
5. bake  + run verify-stn-consolidation.sql          (S4 gate)
6. S5    read cutover (dedup/join on shipment_id) — deferred
7. S6    drop legacy tracking_number/carrier columns — deferred, irreversible
```

## 8. Rollback

Before S6: flip `RECEIVING_UNIFIED_INBOUND` off — get-or-create/link stops, legacy
`tracking_number` stays authoritative, the additive `shipment_id` column is inert.
Zero data loss. After S6 there is no rollback (column drop is one-way), which is
why S6 is gated on a stable green S4 across ≥1 sync cycle.

## 9. Edge cases

| Input | Behavior |
|---|---|
| Real carrier tracking | STN get-or-create, scan + carton linked |
| Unknown carrier (valid-looking #) | STN row with `carrier='UNKNOWN'` (CARRIER_MISMATCH), linked |
| SKU-format (`PROD:qty`) / blank / <8 char | `registerShipmentPermissive` → null; scan records, `shipment_id` NULL |
| Re-scan same tracking+carton | dedup upsert; STN link re-asserted (idempotent) |
| Concurrent scans same tracking | converge on one STN row (normalized-tracking upsert) |
