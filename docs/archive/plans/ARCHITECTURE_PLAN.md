# Architecture Simplification Plan

## Current State: 38 routes, 7,126 lines, 3-table triangle

```
fba_fnsku_logs <──── tech_serial_numbers ────> station_activity_logs
      ^                     ^                          ^
      └─────────────────────┼──────────────────────────┘
            (circular FKs, 7 duplicated columns)
```

- 10 tech routes (2,268 lines)
- 25 FBA routes (3,702 lines)
- 3 query routes (1,156 lines)
- tech-logs query: 376-line SQL with 3 UNION ALL CTEs
- 27 files with regex-based scan_ref matching

## Target State: SAL as SoT, lean routes, FK join for fba_fnsku_logs

```
station_activity_logs (SoT)
    │
    ├── shipment_id ──> shipping_tracking_numbers (carrier tracking ONLY)
    ├── fnsku ─────────> fba_fnskus (catalog)
    │
    ├── tech_serial_numbers (serial_number + context_station_activity_log_id)
    │
    └── fba_fnsku_logs (FK station_activity_log_id ──> SAL)
         └── lifecycle stages: TECH/SCANNED, PACK/READY, SHIP/SHIPPED
```

---

## Part 1: SAL as Single Source of Truth

### 1A. Slim down `tech_serial_numbers`

**Drop from TSN** (all derivable from SAL via `context_station_activity_log_id`):

| Column | Why remove | Get it from |
|--------|-----------|-------------|
| `shipment_id` | Duplicates SAL | `sal.shipment_id` |
| `orders_exception_id` | Duplicates SAL | `sal.orders_exception_id` |
| `scan_ref` | Duplicates SAL | `sal.scan_ref` |
| `fnsku` | Duplicates SAL | `sal.fnsku` |
| `fnsku_log_id` | Replaced by SAL FK on fba_fnsku_logs | JOIN through SAL |
| `fba_shipment_id` | Duplicates SAL | `sal.fba_shipment_id` |
| `fba_shipment_item_id` | Duplicates SAL | `sal.fba_shipment_item_id` |

**TSN becomes:**
```sql
tech_serial_numbers (
  id SERIAL PRIMARY KEY,
  serial_number TEXT NOT NULL,
  serial_type VARCHAR(20) DEFAULT 'SERIAL',
  tested_by INTEGER REFERENCES staff(id),
  context_station_activity_log_id INTEGER NOT NULL REFERENCES station_activity_logs(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
)
```

7 columns down from 14. `context_station_activity_log_id` becomes NOT NULL.

### 1B. Query pattern

```sql
-- Get serials with full context (replaces all current scan_ref/shipment_id joins)
SELECT
  tsn.serial_number,
  tsn.serial_type,
  sal.fnsku,
  sal.staff_id,
  COALESCE(stn.tracking_number_raw, sal.scan_ref, sal.fnsku) AS tracking_display,
  sal.fba_shipment_id,
  sal.orders_exception_id
FROM tech_serial_numbers tsn
JOIN station_activity_logs sal ON sal.id = tsn.context_station_activity_log_id
LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
```

One join path. No regex. No COALESCE chains on TSN.

### 1C. Migration

```sql
-- Phase 1: Backfill context_station_activity_log_id where NULL
UPDATE tech_serial_numbers tsn
SET context_station_activity_log_id = (
  SELECT sal.id FROM station_activity_logs sal
  WHERE sal.tech_serial_number_id = tsn.id
    AND sal.activity_type = 'SERIAL_ADDED'
  ORDER BY sal.created_at DESC LIMIT 1
)
WHERE tsn.context_station_activity_log_id IS NULL;

-- Phase 2: For FNSKU rows, backfill from fnsku_log_id -> SAL metadata
UPDATE tech_serial_numbers tsn
SET context_station_activity_log_id = (
  SELECT sal.id FROM station_activity_logs sal
  WHERE sal.activity_type = 'FNSKU_SCANNED'
    AND sal.station = 'TECH'
    AND (sal.metadata->>'fnsku_log_id')::bigint = tsn.fnsku_log_id
  ORDER BY sal.created_at DESC LIMIT 1
)
WHERE tsn.context_station_activity_log_id IS NULL
  AND tsn.fnsku_log_id IS NOT NULL;

-- Phase 3: Make NOT NULL after verification
ALTER TABLE tech_serial_numbers
  ALTER COLUMN context_station_activity_log_id SET NOT NULL;

-- Phase 4: Drop redundant columns (after code is updated)
ALTER TABLE tech_serial_numbers
  DROP COLUMN shipment_id,
  DROP COLUMN orders_exception_id,
  DROP COLUMN scan_ref,
  DROP COLUMN fnsku,
  DROP COLUMN fnsku_log_id,
  DROP COLUMN fba_shipment_id,
  DROP COLUMN fba_shipment_item_id;
```

---

## Part 2: fba_fnsku_logs FK join to SAL

### 2A. Add `station_activity_log_id` FK to `fba_fnsku_logs`

Currently `fba_fnsku_logs` and SAL cross-reference via:
- SAL.metadata.fnsku_log_id (soft, in JSON)
- fba_fnsku_logs.tech_serial_number_id (never set in FNSKU path)

Replace with a real FK:

```sql
ALTER TABLE fba_fnsku_logs
  ADD COLUMN station_activity_log_id INTEGER REFERENCES station_activity_logs(id) ON DELETE SET NULL;
```

### 2B. Who writes `fba_fnsku_logs` and what stage?

| Writer | source_stage | event_type | New approach |
|--------|-------------|------------|--------------|
| `performTechFnskuScan` | TECH | SCANNED | SAL row created first, FK set on fba_fnsku_logs |
| `fba/items/ready` | TECH | READY | Pack station marks ready, links to SAL if available |
| `fba/items/scan` | PACK | SCANNED | Packer scan, own SAL row |
| `fba/items/verify` | PACK | VERIFIED | Packer verify |
| `fba/labels/bind` | PACK | LABEL_ASSIGNED | Label binding |
| `fba/shipments/close` | SHIP | SHIPPED | Shipment close |
| `fba/shipments/mark-shipped` | SHIP | SHIPPED | Bulk ship |

**Tech path**: `performTechFnskuScan` creates both SAL and fba_fnsku_logs. Set the FK directly:

```ts
// 1. Create SAL row
const salId = await createStationActivityLog({
  station: 'TECH', activityType: 'FNSKU_SCANNED', fnsku, staffId, ...
});

// 2. Create fba_fnsku_logs row WITH FK back to SAL
await db.query(
  `INSERT INTO fba_fnsku_logs (fnsku, source_stage, event_type, staff_id, station_activity_log_id, ...)
   VALUES ($1, 'TECH', 'SCANNED', $2, $3, ...)`,
  [fnsku, staffId, salId]
);
```

**Pack/Ship path**: These endpoints already create their own SAL rows (via PACK_COMPLETED, FBA_READY activity types). Same pattern — set FK on insert.

### 2C. Drop `tech_serial_number_id` from `fba_fnsku_logs`

This column is never set in the FNSKU scan path. It was meant as a back-link to TSN but `station_activity_log_id` replaces it. The real join path is:

```
fba_fnsku_logs.station_activity_log_id → SAL.id
                                          ↑
tech_serial_numbers.context_station_activity_log_id ──┘
```

Serials for an FNSKU scan session = TSN rows whose `context_station_activity_log_id` matches the SAL row that the `fba_fnsku_logs` row points to.

### 2D. Drop `fnsku_log_id` from SAL metadata

Currently `performTechFnskuScan` stores `fnsku_log_id` in `sal.metadata`. With the FK on `fba_fnsku_logs`, the relationship is reversed — you join from fba_fnsku_logs to SAL, not SAL to fba_fnsku_logs.

```sql
-- Get fba_fnsku_logs for a SAL row
SELECT fl.* FROM fba_fnsku_logs fl
WHERE fl.station_activity_log_id = $1;

-- Get all serials for an FNSKU scan session
SELECT tsn.serial_number FROM tech_serial_numbers tsn
WHERE tsn.context_station_activity_log_id = $1;
```

Both queries use the same SAL id. No metadata parsing.

### 2E. Migration

```sql
-- Backfill station_activity_log_id on existing fba_fnsku_logs
UPDATE fba_fnsku_logs fl
SET station_activity_log_id = (
  SELECT sal.id FROM station_activity_logs sal
  WHERE sal.activity_type = 'FNSKU_SCANNED'
    AND sal.station = 'TECH'
    AND sal.fnsku = fl.fnsku
    AND sal.staff_id = fl.staff_id
    AND sal.created_at BETWEEN fl.created_at - INTERVAL '5 seconds' AND fl.created_at + INTERVAL '5 seconds'
  ORDER BY sal.created_at DESC LIMIT 1
)
WHERE fl.source_stage = 'TECH' AND fl.station_activity_log_id IS NULL;

-- Drop dead column
ALTER TABLE fba_fnsku_logs DROP COLUMN tech_serial_number_id;
```

---

## Part 3: Lean API Routes

### 3A. Consolidate tech routes (10 -> 5)

| Current routes | Merge into | Reason |
|---------------|-----------|--------|
| `scan-tracking` (701 lines) | `scan` | Single scan entry point |
| `scan-fnsku` (73 lines) | `scan` | Same flow, different scan type |
| `add-serial` (106 lines) | `serial` | Serial operations |
| `add-serial-to-last` (170 lines) | `serial` | Serial operations |
| `update-serials` (389 lines) | `serial` | Serial operations |
| `undo-last` (94 lines) | `serial` | Serial operations |
| `scan-sku` (217 lines) | `scan` | SKU scan is a scan type |
| `scan-repair-station` (102 lines) | `scan` | Repair scan is a scan type |
| `delete-tracking` (234 lines) | `delete` | Delete operations |
| `orders-without-manual` (182 lines) | stays (read-only) | Query, no change needed |

**5 routes:**

#### `POST /api/tech/scan` — unified scan entry point
```ts
// Body: { type: 'TRACKING' | 'FNSKU' | 'SKU' | 'REPAIR', value: string, techId, ... }
// 1. Resolve scan type (or accept explicit type)
// 2. Create SAL row (always)
// 3. For TRACKING: resolveShipmentId, set sal.shipment_id
// 4. For FNSKU: set sal.fnsku, create fba_fnsku_logs row with FK
// 5. For SKU: set sal.scan_ref with sku:qty
// 6. Return { salId, order, serialNumbers, ... }
```

Replaces: `scan-tracking` (701 lines) + `scan-fnsku` (73) + `scan-sku` (217) + `scan-repair-station` (102) = **1,093 lines -> ~300 lines**

The core logic:
```ts
async function handleScan(type, value, techId) {
  const staffId = await resolveStaff(techId);

  // Every scan creates exactly one SAL row
  const sal = await createStationActivityLog({
    station: 'TECH',
    activityType: `${type}_SCANNED`,
    staffId,
    ...(type === 'TRACKING' ? { shipmentId: await resolveShipmentId(value) } : {}),
    ...(type === 'FNSKU' ? { fnsku: value } : {}),
    ...(type === 'SKU' || type === 'REPAIR' ? { scanRef: value } : {}),
  });

  // Type-specific follow-up
  if (type === 'FNSKU') {
    await createFbaFnskuLog({ fnsku: value, stationActivityLogId: sal.id, ... });
  }

  // Resolve order context
  const order = await resolveOrderForScan(sal);
  const serials = await getSerialsBySalId(sal.id);

  return { salId: sal.id, order, serials };
}
```

#### `POST /api/tech/serial` — all serial operations
```ts
// Body: { action: 'add' | 'remove' | 'update' | 'undo', salId, serial?, serials?, techId }
// 1. Validate SAL row exists and belongs to tech
// 2. For 'add': INSERT TSN row with context_station_activity_log_id = salId
// 3. For 'remove': DELETE TSN row by id
// 4. For 'update': diff desired vs existing, batch insert/delete
// 5. For 'undo': remove last TSN row
// 6. Return { serialNumbers: [...] }
```

Replaces: `add-serial` (106) + `add-serial-to-last` (170) + `update-serials` (389) + `undo-last` (94) = **759 lines -> ~200 lines**

The core logic:
```ts
async function handleSerial(action, salId, params) {
  // SAL id is the key — no tracking resolution needed
  const existing = await db.query(
    `SELECT id, serial_number FROM tech_serial_numbers
     WHERE context_station_activity_log_id = $1 ORDER BY id`,
    [salId]
  );

  switch (action) {
    case 'add':
      await db.query(
        `INSERT INTO tech_serial_numbers (serial_number, serial_type, tested_by, context_station_activity_log_id)
         VALUES ($1, $2, $3, $4)`,
        [params.serial, params.serialType, params.staffId, salId]
      );
      break;
    case 'remove':
      await db.query(`DELETE FROM tech_serial_numbers WHERE id = $1`, [params.tsnId]);
      break;
    case 'update':
      // Diff desired vs existing, minimal inserts/deletes
      break;
    case 'undo':
      await db.query(
        `DELETE FROM tech_serial_numbers WHERE id = (
           SELECT id FROM tech_serial_numbers
           WHERE context_station_activity_log_id = $1 ORDER BY id DESC LIMIT 1
         )`, [salId]
      );
      break;
  }

  return getSerialsBySalId(salId);
}
```

#### `POST /api/tech/delete` — delete scan + cascade
```ts
// Body: { salId }
// 1. Delete TSN rows where context_station_activity_log_id = salId
// 2. Delete fba_fnsku_logs where station_activity_log_id = salId
// 3. Delete SAL row
```

Replaces: `delete-tracking` (234 lines) -> **~50 lines**

#### `GET /api/tech/logs` — simplified query
```sql
SELECT
  sal.id,
  sal.activity_type,
  sal.created_at,
  sal.staff_id AS tested_by,
  sal.fnsku,
  COALESCE(stn.tracking_number_raw, sal.scan_ref, sal.fnsku) AS shipping_tracking_number,
  (SELECT STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.created_at)
   FROM tech_serial_numbers tsn
   WHERE tsn.context_station_activity_log_id = sal.id) AS serial_number,
  o.id AS order_db_id,
  o.order_id,
  o.product_title,
  o.item_number,
  o.condition,
  o.sku,
  o.quantity,
  o.notes,
  o.status_history,
  o.account_source,
  COALESCE(wa.deadline_at::text, '') AS ship_by_date
FROM station_activity_logs sal
LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
LEFT JOIN orders o ON o.shipment_id = sal.shipment_id
LEFT JOIN LATERAL (
  SELECT wa.deadline_at FROM work_assignments wa
  WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id AND wa.work_type = 'TEST'
  ORDER BY wa.updated_at DESC LIMIT 1
) wa ON TRUE
WHERE sal.station = 'TECH'
  AND sal.activity_type IN ('TRACKING_SCANNED', 'FNSKU_SCANNED')
  AND sal.staff_id = $1
  AND sal.created_at BETWEEN $2 AND $3
ORDER BY sal.created_at DESC
```

Replaces: `tech-logs` (376 lines, 3 CTEs) -> **~50 lines, 1 query**

No UNION ALL. No regex matching. No DISTINCT ON hacks.

#### `GET /api/tech/orders-without-manual` — stays as-is (read-only)

### 3B. Consolidate FBA log writes

Currently 15+ endpoints write to `fba_fnsku_logs` directly. Extract a shared function:

```ts
// src/lib/fba/createFbaLog.ts
export async function createFbaLog(db, params: {
  fnsku: string;
  sourceStage: 'TECH' | 'PACK' | 'SHIP' | 'ADMIN';
  eventType: string;
  staffId: number;
  stationActivityLogId?: number;  // FK to SAL
  fbaShipmentId?: number;
  fbaShipmentItemId?: number;
  quantity?: number;
  notes?: string;
  metadata?: Record<string, unknown>;
}) {
  return db.query(
    `INSERT INTO fba_fnsku_logs
     (fnsku, source_stage, event_type, staff_id, station_activity_log_id,
      fba_shipment_id, fba_shipment_item_id, quantity, notes, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [params.fnsku, params.sourceStage, params.eventType, params.staffId,
     params.stationActivityLogId ?? null, params.fbaShipmentId ?? null,
     params.fbaShipmentItemId ?? null, params.quantity ?? 1,
     params.notes ?? null, params.metadata ?? {}]
  );
}
```

All 15 endpoints call this instead of inline INSERT. Single place to add validation, auditing, or schema changes.

---

## Part 4: Summary

### Line count reduction

| Area | Before | After | Saved |
|------|--------|-------|-------|
| Tech API routes | 2,268 | ~800 | 65% |
| tech-logs query | 376 | ~50 | 87% |
| TSN columns | 14 | 7 | 50% |
| Cross-reference columns | 6 circular | 2 straight | 67% |
| Regex matching files | 27 | 0 (in tech path) | 100% |
| fba_fnsku_logs writes | 15 inline INSERTs | 1 shared function | unified |

### Data flow after

```
Tech scans tracking:
  → SAL row (shipment_id → STN)
  → Return salId to client

Tech scans FNSKU:
  → SAL row (fnsku set)
  → fba_fnsku_logs row (station_activity_log_id → SAL)
  → Return salId to client

Tech scans serial:
  → TSN row (context_station_activity_log_id → SAL)
  → SAL row (SERIAL_ADDED, tech_serial_number_id → TSN)

Delete:
  → DELETE TSN WHERE context_station_activity_log_id = salId
  → DELETE fba_fnsku_logs WHERE station_activity_log_id = salId
  → DELETE SAL WHERE id = salId
```

### Implementation order

| Phase | What | Risk | Effort |
|-------|------|------|--------|
| 1 | Backfill `context_station_activity_log_id` on all TSN rows | Data only | Low |
| 2 | Add `station_activity_log_id` FK to `fba_fnsku_logs`, backfill | Data only | Low |
| 3 | Extract `createFbaLog` shared function, update all 15 callers | Refactor | Medium |
| 4 | Build `POST /api/tech/scan` (unified) | New route | Medium |
| 5 | Build `POST /api/tech/serial` (unified) | New route | Medium |
| 6 | Build `POST /api/tech/delete` (simplified) | New route | Low |
| 7 | Build `GET /api/tech/logs` (simplified query) | New route | Medium |
| 8 | Update frontend to use new routes (salId instead of tracking) | Frontend | Medium |
| 9 | Drop old routes + redundant TSN columns | Cleanup | Low |
