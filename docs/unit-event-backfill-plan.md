# Unit audit-trail backfill plan (P0-TRACE-01, acceptance C)

The append-only unit event log lives in **`inventory_events`** (unit-anchored
spine). Every state-changing write path now appends one row via the single
choke-point `recordInventoryEvent()` (`src/lib/inventory/events.ts`), usually
through the `transition()` state machine or the `recordUnitEvent()` façade.

Units that predate full write-path coverage have a *current state* in
`serial_units` (and dated facts in `serial_units`, `audit_logs`,
`station_activity_logs`, `serial_unit_condition_history`,
`order_unit_allocations`) but may be **missing the intermediate event rows**.
This document describes how to reconstruct those events. It is **idempotent,
append-only, and never mutates a serial**.

## System-of-record boundary

- **Supabase/Postgres owns unit truth.** Backfill reads/writes only Postgres.
- **Zoho is NEVER read or written** during backfill. No SKU quantity or
  financial data enters `inventory_events`.
- **Serials are never regenerated or mutated.** Backfill only *references*
  `serial_units.id` / `.serial_number`.

## Source-of-truth mapping (event ← existing fact)

| Reconstructed event | Source table.column | Timestamp | Actor |
|---|---|---|---|
| `RECEIVED` | `serial_units.received_at` (fallback `created_at`) | `received_at` | `serial_units.received_by` |
| `TEST_PASS` / `TEST_FAIL` | `tech_serial_numbers` verdict / `serial_unit_condition_history` | `assessed_at` / verdict ts | `assessed_by_staff_id` |
| `GRADED` | `serial_unit_condition_history` (one row per grade change) | `assessed_at` | `assessed_by_staff_id` |
| `PUTAWAY` | `serial_units.current_location` when `current_status='STOCKED'` and no PUTAWAY event exists | `updated_at` (best-effort) | null (system) |
| `ALLOCATED` / `RELEASED` | `order_unit_allocations.allocated_at` / `released_at` | those columns | `allocated_by_staff_id` |
| `PACKED` / `LABELED` / `SHIPPED` | `audit_logs` (order-anchored) + `station_activity_logs` (PACK/OUTBOUND) joined to the order's allocated units | row `created_at` | `actor_staff_id` / `staff_id` |
| `RETURNED` | `serial_units.current_status='RETURNED'` + RMA rows | RMA / status-change ts | RMA actor |

`serial_unit_condition_history` and `unit_failure_tags` already carry an
`inventory_event_id` FK; rows where that is NULL but the assessment predates
coverage are prime backfill candidates (link the new event back into them).

## Idempotency contract

Every synthesized event gets a deterministic `client_event_id`:

```
backfill:{event_type}:{serial_unit_id}:{source_table}:{source_id}
```

`inventory_events.client_event_id` is UNIQUE and `recordInventoryEvent()` does
`ON CONFLICT (client_event_id) DO UPDATE SET event_type = event_type` (no-op,
returns the existing row). So **re-running the backfill is a no-op** — it never
duplicates and never overwrites a real (non-backfill) event.

## Org scoping

`inventory_events.organization_id` is NOT NULL with a GUC default. The backfill
must run per-org: set `app.current_org` (via `withTenantTransaction(orgId, …)`)
and pass `orgId` to `recordInventoryEvent(input, client, orgId)` so each
synthesized row is stamped to the correct tenant. The source rows are already
org-scoped; carry that org through — never collapse to the USAV fallback.

## Dry-run-first procedure

1. **Dry run (no writes):** `node scripts/backfill-inventory-events.mjs --dry`
   - Prints, per org, how many of each event type WOULD be inserted and how many
     already exist (skipped). Writes nothing.
2. **Review counts** against `SELECT event_type, count(*) FROM inventory_events
   GROUP BY 1` and the live introspection.
3. **Apply for one org:** `node scripts/backfill-inventory-events.mjs --org=<uuid>`
4. **Apply all:** `node scripts/backfill-inventory-events.mjs --apply`

The script is **read-only by default** (`--dry` is the implicit default; `--apply`
is required to write). It opens a per-org tenant transaction and rolls back on
any error so a partial run never half-populates.

## Reversibility

Because every backfilled row carries `client_event_id LIKE 'backfill:%'`, the
entire backfill is reversible without touching real events:

```sql
-- inspect first
SELECT event_type, count(*) FROM inventory_events
 WHERE client_event_id LIKE 'backfill:%' GROUP BY 1;
-- reverse (per org; run inside withTenantTransaction so RLS scopes it)
DELETE FROM inventory_events WHERE client_event_id LIKE 'backfill:%';
```

Real operational events never match that prefix, so the delete is safe and
surgical. (Rows linked from `serial_unit_condition_history.inventory_event_id`
are ON DELETE SET NULL, so the reverse won't cascade-damage history.)

## Status

Documented, not executed. The current live table already has organic coverage
(RECEIVED 2582, LABELED 169, TEST_* 136, PUTAWAY 77, GRADED 28, ALLOCATED 1 as
of 2026-06-21) so a backfill is optional hygiene, not a correctness blocker.
Run the dry-run before any apply.
