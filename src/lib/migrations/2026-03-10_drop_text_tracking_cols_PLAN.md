# Migration Plan: Drop Duplicate tracking columns → Central FK on shipping_tracking_numbers

## Current State (post-backfill)

| Table | shipment_id coverage | Unlinked rows | Reason unlinked |
|-------|---------------------|---------------|-----------------|
| orders | 835 / 835 | 0 | — |
| tech_serial_numbers | 570 / 573 | 3 | 1 lowercase UPS#, 2 FNSKU (x00…) |
| packer_logs | 972 / 1043 | 71 | 47 SKU scans, 20 ORDERS w/ SKU-format input, 4 CLEAN |
| orders_exceptions | 238 / 241 | 3 | Garbled/short scan values |

---

## What We Are Dropping

- `packer_logs.shipping_tracking_number TEXT NOT NULL`
- `tech_serial_numbers.shipping_tracking_number TEXT NOT NULL`

## What We Are NOT Dropping

- `orders.shipping_tracking_number` — canonical business field; imported from ShipStation; displayed everywhere
- `orders_exceptions.shipping_tracking_number` — identity field for exception queue; keep as-is
- `sku.shipping_tracking_number` — internal reference, not a carrier tracking number

---

## Root Problem: packer_logs stores two kinds of "scan" in one column

`packer_logs.shipping_tracking_number` is currently overloaded:

| tracking_type | stored value | is a carrier tracking number? |
|--------------|--------------|-------------------------------|
| ORDERS | carrier tracking# (UPS/USPS/FEDEX) | ✅ yes → maps to shipment_id |
| SKU | e.g. `1103:A28` | ❌ no, it's a SKU scan ref |
| FBA | FNSKU e.g. `X0049M1EDD` | ❌ no, it's an FBA item ref |
| CLEAN | internal station code | ❌ no |

### Solution before drop:
Add `scan_ref TEXT` to `packer_logs` to store the raw input for non-carrier scan types.
Backfill `scan_ref` from `shipping_tracking_number` for all non-ORDERS rows.
For ORDERS rows, `scan_ref` is redundant (raw input is `stn.tracking_number_raw`).

For `tech_serial_numbers`, the same: 570 rows are carrier tracking numbers (covered by `shipment_id`),
3 rows are FNSKU/lowercase. Add `fnsku_ref TEXT` for FBA rows if needed, or rely on existing `fnsku` column.

---

## Execution Order (5 phases, do not skip steps)

```
Phase 0 → Fix normalization bug → re-backfill 3 unlinked tech rows
Phase 1 → Add scan_ref column to packer_logs → backfill from non-ORDERS rows  
Phase 2 → Update all WRITE paths (6 files) to populate shipment_id
Phase 3 → Update all READ paths (8 files) to JOIN via shipment_id
Phase 4 → Drop text columns + update Drizzle schema + TypeScript interfaces
```

---

## Phase 0: Fix the 3 Unlinked tech_serial_numbers Rows

Bug: SQL UPDATE used `UPPER(REGEXP_REPLACE(col, '[^A-Z0-9]', ''))` which strips lowercase letters
BEFORE upper-casing them. JavaScript normalization did `toUpperCase().replace(...)` correctly.

Fix (run in DB):
```sql
UPDATE tech_serial_numbers tsn
SET    shipment_id = stn.id
FROM   shipping_tracking_numbers stn
WHERE  stn.tracking_number_normalized =
         UPPER(REGEXP_REPLACE(UPPER(COALESCE(tsn.shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'))
  AND  tsn.shipment_id IS NULL
  AND  tsn.shipping_tracking_number IS NOT NULL;
```

The 2 remaining FNSKU rows (x0049m1edd, x00390uumr) stay NULL — they are FBA item refs, not carrier
shipments. `shipment_id` NULL is correct for them.

---

## Phase 1: Add scan_ref to packer_logs

```sql
-- Add scan_ref to hold raw input for non-carrier scan types
ALTER TABLE packer_logs ADD COLUMN IF NOT EXISTS scan_ref TEXT;

-- Backfill: for SKU/FBA/CLEAN rows, scan_ref = current shipping_tracking_number
UPDATE packer_logs
SET    scan_ref = shipping_tracking_number
WHERE  tracking_type <> 'ORDERS'
  AND  scan_ref IS NULL;

-- For ORDERS rows: scan_ref remains NULL (raw tracking accessible via stn.tracking_number_raw)
```

New packer_logs schema:
- `shipment_id BIGINT FK → shipping_tracking_numbers(id)` — populated for carrier scans
- `scan_ref TEXT` — populated for SKU/FBA/CLEAN scans
- `tracking_type VARCHAR` — still needed to distinguish the two paths
- `shipping_tracking_number TEXT` — DROP after all reads/writes are migrated

---

## Phase 2: Update All WRITE Paths

### File 1: `src/app/api/packing-logs/route.ts` (POST — StationPacking entry point)

Three INSERT locations, all in the POST handler.

**Current pattern (3× in file):**
```typescript
INSERT INTO packer_logs (shipping_tracking_number, tracking_type, pack_date_time, packed_by)
VALUES ($1, $2, $3, $4)
```

**New pattern (ORDERS type — lines ~192, ~271):**
```typescript
// 1. Upsert shipment master record
const { upsertShipment, registerShipment } = await import('@/lib/shipping/sync-shipment');
const shipment = await registerShipment({
  trackingNumber: order.shipping_tracking_number,  // use canonical value from orders
  sourceSystem: 'packer_logs',
});

// 2. Insert packer_log with shipment_id (no shipping_tracking_number column)
INSERT INTO packer_logs (shipment_id, tracking_type, pack_date_time, packed_by)
VALUES ($1, $2, $3, $4)
```

**New pattern (non-ORDERS type — line ~323):**
```typescript
// No shipment. Store raw input in scan_ref.
INSERT INTO packer_logs (scan_ref, tracking_type, pack_date_time, packed_by)
VALUES ($1, $2, $3, $4)
```

Response field `shippingTrackingNumber` in return JSON:
- Change to source from `stn.tracking_number_raw` via shipment JOIN, or keep as local variable
  (it's display-only in StationPacking and doesn't need to be stored)

---

### File 2: `src/app/api/packerlogs/route.ts` (POST — admin view Drizzle insert)

**Current (line ~127):**
```typescript
await db.insert(packerLogs).values({
  shippingTrackingNumber: body.shippingTrackingNumber,
  trackingType: body.trackingType || 'ORDERS',
  packDateTime: body.packDateTime,
  packedBy: body.packedBy,
});
```

**New:**
```typescript
// Upsert shipment_id for ORDERS-type inserts
let shipmentId: number | null = null;
if ((body.trackingType || 'ORDERS') === 'ORDERS' && body.shippingTrackingNumber) {
  const shipment = await registerShipment({
    trackingNumber: body.shippingTrackingNumber,
    sourceSystem: 'packer_logs',
  });
  shipmentId = shipment.id;
}

await db.insert(packerLogs).values({
  shipmentId,
  scanRef: (body.trackingType || 'ORDERS') !== 'ORDERS' ? body.shippingTrackingNumber : null,
  trackingType: body.trackingType || 'ORDERS',
  packDateTime: body.packDateTime,
  packedBy: body.packedBy,
});
```

---

### File 3: `src/lib/neon/tech-logs-queries.ts` (createTechLog + updateTechLog)

**Current createTechLog:**
```typescript
INSERT INTO tech_serial_numbers
  (serial_number, shipping_tracking_number, tested_by, test_date_time, fnsku, notes)
VALUES ($1, $2, $3, $4, $5, $6)
```

**New createTechLog:**
```typescript
// Resolve shipment_id from tracking number (null if FNSKU/no carrier match)
let shipmentId: number | null = null;
if (params.shippingTrackingNumber) {
  const norm = normalizeTrackingNumber(params.shippingTrackingNumber);
  const carrier = detectCarrier(norm);
  if (carrier) {
    const shipment = await upsertShipment({
      trackingNumberRaw: params.shippingTrackingNumber,
      trackingNumberNormalized: norm,
      carrier,
      sourceSystem: 'tech_serial_numbers',
    });
    shipmentId = shipment.id;
  }
}

INSERT INTO tech_serial_numbers
  (serial_number, shipment_id, tested_by, test_date_time, fnsku, notes)
VALUES ($1, $2, $3, $4, $5, $6)
```

updateTechLog: same pattern when `shippingTrackingNumber` is in the update set.

---

### File 4: `src/lib/orders-exceptions.ts` (upsertOpenOrderException)

**Current:** inserts `shipping_tracking_number` only.

**New:** also upsert into shipping_tracking_numbers + set `shipment_id`:
```typescript
const norm = normalizeTrackingNumber(tracking);
const carrier = detectCarrier(norm) ?? 'UNKNOWN';
let shipmentId: number | null = null;
if (norm.length >= 8) {
  const shipment = await upsertShipment({
    trackingNumberRaw: tracking,
    trackingNumberNormalized: norm,
    carrier,
    sourceSystem: 'orders_exceptions',
  });
  shipmentId = shipment.id;
}
// Include shipment_id in INSERT / ON CONFLICT DO UPDATE
```

---

### Files 5–7: Sync routes (bulk-insert into tech_serial_numbers)

All three routes share the same INSERT pattern. Add shipment resolution per row:

- `src/app/api/sync-sheets-to-tech-serials/route.ts`
- `src/app/api/google-sheets/execute-script/route.ts`
- `src/app/api/sync-sheets/route.ts`

**Change:** After resolving each row's `shippingTrackingNumber`, call `upsertShipment()` and include
`shipment_id` in the INSERT. Best done in batch: collect all distinct tracking numbers, bulk-upsert
to `shipping_tracking_numbers`, then JOIN to get IDs before INSERT to `tech_serial_numbers`.

---

## Phase 3: Update All READ Paths

### Old join pattern being replaced everywhere:
```sql
-- BEFORE: fuzzy last-8 match (slow, collision-prone)
LEFT JOIN orders o
  ON RIGHT(regexp_replace(o.shipping_tracking_number, '\\D','','g'), 8)
   = RIGHT(regexp_replace(pl.shipping_tracking_number,'\\D','','g'), 8)
```

### New join pattern:
```sql
-- AFTER: clean FK chain through shipping_tracking_numbers
LEFT JOIN shipping_tracking_numbers stn ON stn.id = pl.shipment_id
LEFT JOIN orders o ON o.shipment_id = stn.id
```

You also get carrier status for FREE in every query that joins this way:
`stn.latest_status_category`, `stn.is_delivered`, `stn.delivered_at`, `stn.carrier`

---

### File 1: `src/app/api/packing-logs/route.ts` (GET — StationPacking history)

**Current (line ~87):**
```sql
SELECT pl.id, pl.pack_date_time, pl.shipping_tracking_number, pl.tracking_type, o.product_title
FROM packer_logs pl
LEFT JOIN orders o ON o.shipping_tracking_number = pl.shipping_tracking_number
WHERE pl.packed_by = $1
```

**New:**
```sql
SELECT
    pl.id,
    pl.pack_date_time AS timestamp,
    pl.tracking_type,
    COALESCE(stn.tracking_number_raw, pl.scan_ref) AS tracking,
    stn.carrier,
    stn.latest_status_category,
    stn.is_delivered,
    o.product_title AS title,
    o.order_id
FROM packer_logs pl
LEFT JOIN shipping_tracking_numbers stn ON stn.id = pl.shipment_id
LEFT JOIN orders o ON o.shipment_id = stn.id
WHERE pl.packed_by = $1
ORDER BY pl.id DESC
LIMIT $2 OFFSET $3
```

Response gains: `carrier`, `latest_status_category`, `is_delivered` — new fields surfaced to UI for free.

---

### File 2: `src/app/api/packerlogs/route.ts` (GET — admin/reporting view)

**Current (lines ~53–110):** 5 correlated subqueries joining on `RIGHT(... 8)` match.

**New:**
```sql
SELECT
    pl.id,
    pl.pack_date_time,
    pl.tracking_type,
    COALESCE(stn.tracking_number_raw, pl.scan_ref) AS shipping_tracking_number,
    pl.packed_by,
    stn.carrier,
    stn.latest_status_category,
    stn.is_delivered,
    stn.delivered_at,
    o.order_id,
    o.product_title,
    o.condition,
    o.quantity,
    o.sku,
    COALESCE(
        (SELECT json_agg(...) FROM photos p WHERE p.entity_type='PACKER_LOG' AND p.entity_id=pl.id),
        '[]'::json
    ) AS packer_photos_url
FROM packer_logs pl
LEFT JOIN shipping_tracking_numbers stn ON stn.id = pl.shipment_id
LEFT JOIN orders o ON o.shipment_id = stn.id
${whereClause}
ORDER BY pl.pack_date_time DESC NULLS LAST
LIMIT $N OFFSET $M
```

Eliminates 4 correlated subqueries → single JOIN → faster + more columns.

---

### File 3: `src/lib/neon/packing-logs-queries.ts`

- `getPackingLogs()` — add JOIN, remove WHERE on text column; add `shipment_id` filter option
- `getPackingLogByTracking(tracking)` — replace last-8 text search with:
  ```sql
  WHERE pl.shipment_id = (
    SELECT id FROM shipping_tracking_numbers
    WHERE tracking_number_normalized = $1
  )
  ```
- `createPackingLog()` — take `shipmentId` instead of `shippingTrackingNumber` for ORDERS type
- Update `PackingLog` interface: remove `shipping_tracking_number`, add `shipment_id`, `scan_ref`,
  `carrier?`, `latest_status_category?`

---

### File 4: `src/app/api/tech-logs/route.ts` (GET — tech station history)

**Current (lines ~77–143):** lateral JOIN on `RIGHT(regexp_replace... 8)` text match.

**New:**
```sql
SELECT
    tsn.id,
    tsn.test_date_time,
    tsn.serial_number,
    tsn.tested_by,
    stn.tracking_number_raw AS shipping_tracking_number,  -- backward compat alias
    stn.carrier,
    stn.latest_status_category,
    stn.is_delivered,
    o.order_id,
    o.ship_by_date, o.product_title, o.quantity, o.condition,
    o.sku, o.account_source, o.notes, o.out_of_stock, o.is_shipped,
    fba.product_title AS fba_product_title
FROM tech_serial_numbers tsn
LEFT JOIN shipping_tracking_numbers stn ON stn.id = tsn.shipment_id
LEFT JOIN orders o ON o.shipment_id = stn.id
LEFT JOIN LATERAL (
    SELECT product_title FROM fba_fnskus
    WHERE fnsku = tsn.fnsku  -- for FBA rows where shipment_id IS NULL
    LIMIT 1
) fba ON true
WHERE tsn.tested_by = $1 AND tsn.test_date_time IS NOT NULL
${weekClause}
ORDER BY tsn.test_date_time DESC NULLS LAST
LIMIT $N OFFSET $M
```

---

### File 5: `src/lib/neon/tech-logs-queries.ts`

- `getTechLogs()` — replace lateral JOIN with FK JOIN
- `searchTechLogs()` — replace text match `tsn.shipping_tracking_number ILIKE $1` with:
  ```sql
  OR stn.tracking_number_normalized ILIKE $1
  ```
  (requires joining stn first)
- `deleteLatestTechLogByTracking(tracking)` — replace last-8 text match with:
  ```sql
  WHERE tsn.shipment_id = (
    SELECT id FROM shipping_tracking_numbers
    WHERE tracking_number_normalized = normalize($1)
  )
  ```
- `getSerialsByTracking(tracking)` — same pattern
- Update `TechSerialNumber` interface: remove `shipping_tracking_number`, add `shipment_id`

---

### File 6: `src/app/api/check-tracking/route.ts`

**Current (line ~57):**
```sql
FROM packer_logs WHERE shipping_tracking_number ILIKE $1
```

**New:**
```sql
FROM packer_logs pl
JOIN shipping_tracking_numbers stn ON stn.id = pl.shipment_id
WHERE stn.tracking_number_normalized ILIKE $1
   OR stn.tracking_number_raw ILIKE $1
```

---

### File 7: `src/app/api/orders/next/route.ts`

Likely JOINs `tech_serial_numbers` via `shipping_tracking_number`. Replace with:
```sql
JOIN shipping_tracking_numbers stn ON stn.id = tsn.shipment_id
JOIN orders o ON o.shipment_id = stn.id
```

---

### File 8: `src/app/api/ebay/search/route.ts`

**Current:**
```sql
LEFT JOIN tech_serial_numbers tsn ON o.shipping_tracking_number = tsn.shipping_tracking_number
```

**New:**
```sql
LEFT JOIN tech_serial_numbers tsn ON tsn.shipment_id = o.shipment_id
```

One line change. The cleanest one in the whole migration.

---

## Phase 4: Drop Columns + Update Schema

### Migration SQL (`2026-03-10_drop_text_tracking_cols.sql`)

```sql
BEGIN;

-- Drop text tracking columns from packer_logs
ALTER TABLE packer_logs DROP COLUMN IF EXISTS shipping_tracking_number;

-- Drop text tracking column from tech_serial_numbers
ALTER TABLE tech_serial_numbers DROP COLUMN IF EXISTS shipping_tracking_number;

-- Make shipment_id columns recommended-not-null via partial indexes
-- (NOT NULL constraint skipped because SKU/FBA/CLEAN packer rows + FNSKU tech rows stay NULL)
CREATE INDEX IF NOT EXISTS idx_packer_logs_carrier_link
  ON packer_logs(shipment_id) WHERE tracking_type = 'ORDERS';

COMMIT;
```

### Drizzle schema.ts changes

```typescript
// BEFORE
export const packerLogs = pgTable('packer_logs', {
  id: serial('id').primaryKey(),
  shippingTrackingNumber: text('shipping_tracking_number').notNull(),  // ← DROP
  trackingType: varchar('tracking_type', { length: 20 }).notNull(),
  packDateTime: timestamp('pack_date_time'),
  packedBy: integer('packed_by').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});

// AFTER
export const packerLogs = pgTable('packer_logs', {
  id: serial('id').primaryKey(),
  shipmentId: bigint('shipment_id', { mode: 'number' })
    .references(() => shippingTrackingNumbers.id, { onDelete: 'set null' }),
  scanRef: text('scan_ref'),                      // ← stores SKU/FNSKU/CLEAN raw input
  trackingType: varchar('tracking_type', { length: 20 }).notNull(),
  packDateTime: timestamp('pack_date_time'),
  packedBy: integer('packed_by').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});

// BEFORE
export const techSerialNumbers = pgTable('tech_serial_numbers', {
  id: serial('id').primaryKey(),
  shippingTrackingNumber: text('shipping_tracking_number').notNull(),  // ← DROP
  serialNumber: text('serial_number').notNull(),
  serialType: varchar('serial_type', { length: 20 }).notNull().default('SERIAL'),
  testDateTime: timestamp('test_date_time').defaultNow(),
  testedBy: integer('tested_by').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});

// AFTER
export const techSerialNumbers = pgTable('tech_serial_numbers', {
  id: serial('id').primaryKey(),
  shipmentId: bigint('shipment_id', { mode: 'number' })
    .references(() => shippingTrackingNumbers.id, { onDelete: 'set null' }),
  serialNumber: text('serial_number').notNull(),
  serialType: varchar('serial_type', { length: 20 }).notNull().default('SERIAL'),
  testDateTime: timestamp('test_date_time').defaultNow(),
  testedBy: integer('tested_by').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});
```

Also add `shippingTrackingNumbers` table definition to schema.ts.

---

## Phase 5: TypeScript Interface Updates

### `src/lib/neon/packing-logs-queries.ts`
```typescript
// BEFORE
export interface PackingLog {
  id: number;
  shipping_tracking_number: string;  // ← REMOVE
  ...
}
export interface CreatePackingLogParams {
  shippingTrackingNumber: string;  // ← CHANGE to shipmentId: number
  ...
}

// AFTER
export interface PackingLog {
  id: number;
  shipment_id: number | null;      // ← NEW
  scan_ref: string | null;         // ← NEW
  tracking_number_raw?: string;    // ← from JOIN stn
  carrier?: string;                // ← from JOIN stn (bonus)
  latest_status_category?: string; // ← from JOIN stn (bonus)
  packed_by: number | null;
  pack_date_time: string | null;
  tracking_type: string | null;
  ...
}
```

### `src/lib/neon/tech-logs-queries.ts`
```typescript
// BEFORE
export interface TechSerialNumber {
  id: number;
  shipping_tracking_number: string;  // ← REMOVE
  ...
}
export interface CreateTechLogParams {
  shippingTrackingNumber?: string | null;  // ← CHANGE to shipmentId?: number | null
  ...
}

// AFTER
export interface TechSerialNumber {
  id: number;
  shipment_id: number | null;      // ← NEW
  shipping_tracking_number?: string; // ← alias from JOIN stn.tracking_number_raw, for backward compat
  ...
}
```

### `src/lib/neon/orders-table-structure.ts`
- Add `shipment_id` to `OrderRecord` and `ORDER_COLUMNS`
- No removals (orders.shipping_tracking_number stays)

### `src/components/PendingOrdersTable.tsx`
- Line 133: `patched.shipping_tracking_number = shippingTrackingNumber;`
  → Also set `patched.shipment_id` when new shipment is registered
  → No removal needed here since `orders.shipping_tracking_number` stays

---

## Summary: Files Changed Per Phase

### Phase 0 (1 SQL fix)
- Run SQL fix for lowercase tech_serial row

### Phase 1 (1 SQL migration)
- `2026-03-10_add_scan_ref_packer_logs.sql` — ADD scan_ref, backfill, then drop text col later

### Phase 2 — WRITES (7 files)
| File | Change |
|------|--------|
| `src/app/api/packing-logs/route.ts` | POST: 3× INSERT → use shipment_id / scan_ref |
| `src/app/api/packerlogs/route.ts` | POST: Drizzle insert → use shipment_id / scan_ref |
| `src/lib/neon/tech-logs-queries.ts` | createTechLog, updateTechLog → resolve shipment_id |
| `src/lib/orders-exceptions.ts` | upsertOpenOrderException → set shipment_id |
| `src/app/api/sync-sheets-to-tech-serials/route.ts` | bulk INSERT → add shipment_id |
| `src/app/api/google-sheets/execute-script/route.ts` | bulk INSERT → add shipment_id |
| `src/app/api/sync-sheets/route.ts` | bulk INSERT → add shipment_id |

### Phase 3 — READS (8 files)
| File | Change |
|------|--------|
| `src/app/api/packing-logs/route.ts` | GET: JOIN via shipment_id, gains carrier status |
| `src/app/api/packerlogs/route.ts` | GET: replace 5 correlated subqueries with 2 JOINs |
| `src/lib/neon/packing-logs-queries.ts` | getPackingLogs, getPackingLogByTracking, createPackingLog |
| `src/app/api/tech-logs/route.ts` | GET: replace lateral text-match JOIN with FK JOIN |
| `src/lib/neon/tech-logs-queries.ts` | getTechLogs, searchTechLogs, deleteByTracking, getSerialsByTracking |
| `src/app/api/check-tracking/route.ts` | packer_logs query → JOIN via stn |
| `src/app/api/orders/next/route.ts` | tech_serial_numbers JOIN → use shipment_id |
| `src/app/api/ebay/search/route.ts` | 1-line JOIN → `tsn.shipment_id = o.shipment_id` |

### Phase 4 — Drop + Schema (3 files)
| File | Change |
|------|--------|
| `2026-03-10_drop_text_tracking_cols.sql` | DROP COLUMN on both tables |
| `src/lib/drizzle/schema.ts` | Remove text cols, add shipmentId FK + scanRef |
| TypeScript types in neon/ files | Update interfaces |

---

## Risk Gates — Do Not Skip

1. ✅ `shipment_id` must be backfilled before Phase 2 ships to production
2. ✅ Phase 2 (writes) must be deployed before Phase 3 (reads) so new rows have shipment_id
3. ✅ Phase 3 reads must be deployed AND verified before Phase 4 drops the columns
4. ✅ Drop the columns only in a maintenance window or as a zero-downtime migration
   (since dropping NOT NULL column requires a brief lock in Postgres)

## What the UI Gets for Free (StationPacking + History)

After Phase 3, the GET /api/packing-logs and /api/packerlogs queries return:
- `carrier` — UPS / USPS / FEDEX
- `latest_status_category` — IN_TRANSIT / OUT_FOR_DELIVERY / DELIVERED / EXCEPTION
- `is_delivered` — boolean
- `delivered_at` — timestamp

These can be displayed in StationPacking history, PendingOrdersTable, and the shipped orders table
with zero additional API calls — they come for free from the FK join.
