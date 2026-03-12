# Shipment Status Migration — Final Decision Document

> **Date:** 2026-03-11  
> **Scope:** `orders.is_shipped` removal + derived status layer  
> **Depends on:** Phases 0–4 of `2026-03-10_drop_text_tracking_cols_PLAN.md`

---

## Current State Summary

| Table | Shipping column(s) today | shipment_id | Status |
|-------|--------------------------|-------------|--------|
| `orders` | `shipping_tracking_number` TEXT ✅ keep | `shipment_id` BIGINT FK ✅ | **`is_shipped` BOOLEAN — candidate for removal** |
| `packer_logs` | ~~`shipping_tracking_number`~~ dropped in Phase 4 | `shipment_id` BIGINT FK ✅ | `scan_ref` TEXT for non-carrier scans |
| `tech_serial_numbers` | ~~`shipping_tracking_number`~~ dropped in Phase 4 | `shipment_id` BIGINT FK ✅ | `scan_ref` TEXT for FNSKU rows |
| `orders_exceptions` | `shipping_tracking_number` TEXT ✅ keep (identity field) | `shipment_id` BIGINT FK ✅ | — |
| `sku` | `shipping_tracking_number` TEXT ✅ keep (internal ref) | `shipment_id` BIGINT FK ✅ | — |
| `shipping_tracking_numbers` | source of truth | `id` PK | has all status flags |
| `shipment_tracking_events` | append-only event log | `shipment_id` FK | — |

---

## Target Schema — Column Decisions Per Table

### `orders`

| Column | Keep / Drop | Reason |
|--------|-------------|--------|
| `id` | ✅ Keep | PK |
| `order_id` | ✅ Keep | Business identity from ShipStation |
| `shipping_tracking_number` | ✅ Keep | Canonical carrier string imported from ShipStation; displayed in UI; source for `stn` lookup |
| `shipment_id` | ✅ Keep | FK to `shipping_tracking_numbers`; the join key going forward |
| `is_shipped` | ❌ **Drop** (Phase 5) | Derived from `shipping_tracking_numbers`; stale boolean; see derived definition below |
| All other columns | ✅ Keep | Not affected |

### `packer_logs`

| Column | Keep / Drop | Reason |
|--------|-------------|--------|
| `id` | ✅ Keep | PK |
| `shipment_id` | ✅ Keep | FK for ORDERS-type scans |
| `scan_ref` | ✅ Keep | Raw input for SKU / FNSKU / CLEAN scans |
| `tracking_type` | ✅ Keep | Discriminator: ORDERS / SKU / FBA / CLEAN |
| `pack_date_time` | ✅ Keep | Event timestamp |
| `packed_by` | ✅ Keep | Staff FK |
| ~~`shipping_tracking_number`~~ | ❌ Dropped in Phase 4 | Replaced by `shipment_id` + `scan_ref` |

### `tech_serial_numbers`

| Column | Keep / Drop | Reason |
|--------|-------------|--------|
| `id` | ✅ Keep | PK |
| `shipment_id` | ✅ Keep | FK for carrier-tracking rows |
| `scan_ref` | ✅ Keep | Raw input for FNSKU / non-carrier rows |
| `serial_number` | ✅ Keep | Device serial |
| `serial_type` | ✅ Keep | SERIAL / IMEI / FNSKU / etc. |
| `test_date_time` | ✅ Keep | Event timestamp |
| `tested_by` | ✅ Keep | Staff FK |
| ~~`shipping_tracking_number`~~ | ❌ Dropped in Phase 4 | Replaced by `shipment_id` + `scan_ref` |

### `shipping_tracking_numbers`

All columns keep. This is the source of truth for carrier status.  
Key status columns used by derived queries:

| Column | Meaning |
|--------|---------|
| `is_carrier_accepted` | Carrier scanned package — "handed off" |
| `is_in_transit` | Package is moving |
| `is_out_for_delivery` | Out for delivery today |
| `is_delivered` | Confirmed delivered |
| `has_exception` | Carrier exception (lost, damaged, returned) |
| `latest_status_category` | Enum: `LABEL_CREATED \| ACCEPTED \| IN_TRANSIT \| OUT_FOR_DELIVERY \| DELIVERED \| EXCEPTION \| RETURNED` |
| `delivered_at` | Delivery timestamp |

---

## Derived Status Definitions

### `is_packed`
```
True if one or more valid packer_logs rows exist for this order's shipment,
where tracking_type = 'ORDERS'.
```

**SQL expression (for queries):**
```sql
EXISTS (
  SELECT 1 FROM packer_logs pl
  WHERE pl.shipment_id = o.shipment_id
    AND pl.tracking_type = 'ORDERS'
) AS is_packed
```

**Edge cases:**
- Order with no `shipment_id` → `is_packed = false`
- SKU/FBA/CLEAN packer scans do NOT count toward `is_packed`
- Multiple pack logs for same shipment → still `true` (any valid log counts)

---

### `is_shipped`
```
True if the carrier has accepted or is actively transporting the package.
Defined as: is_carrier_accepted OR is_in_transit OR is_out_for_delivery OR is_delivered.
```

**SQL expression (for queries):**
```sql
COALESCE(
  stn.is_carrier_accepted OR
  stn.is_in_transit OR
  stn.is_out_for_delivery OR
  stn.is_delivered,
  false
) AS is_shipped
```

**Via `latest_status_category` (equivalent):**
```sql
COALESCE(stn.latest_status_category, '') NOT IN ('', 'LABEL_CREATED', 'UNKNOWN') AS is_shipped
```

**Edge cases:**
- Order with no `shipment_id` → `is_shipped = false`
- Order with `shipment_id` but `latest_status_category = 'LABEL_CREATED'` → `is_shipped = false` (label printed, not picked up)
- Order with `has_exception = true` → `is_shipped` depends on whether in-transit milestone was reached before exception

---

### `is_delivered`
```
True if shipping_tracking_numbers.is_delivered = true for this order's shipment.
```

**SQL expression (for queries):**
```sql
COALESCE(stn.is_delivered, false) AS is_delivered
```

**Bonus columns available at zero extra cost from the same JOIN:**
```sql
stn.delivered_at,
stn.latest_status_category AS shipment_status,
stn.carrier,
stn.has_exception
```

---

### `has_tech_scan`
```
True if one or more tech_serial_numbers rows exist for this order's shipment.
```

**SQL expression (for queries):**
```sql
EXISTS (
  SELECT 1 FROM tech_serial_numbers tsn
  WHERE tsn.shipment_id = o.shipment_id
) AS has_tech_scan
```

---

## Standard Derived Status Query Pattern

Use this JOIN pattern in every query that needs order status flags:

```sql
SELECT
    o.id,
    o.order_id,
    o.product_title,
    o.sku,
    o.condition,
    o.shipping_tracking_number,
    o.shipment_id,

    -- Carrier status (free from FK join)
    stn.carrier,
    stn.latest_status_category              AS shipment_status,
    stn.is_delivered,
    stn.delivered_at,
    stn.has_exception,

    -- Derived flags
    COALESCE(
      stn.is_carrier_accepted OR stn.is_in_transit OR
      stn.is_out_for_delivery OR stn.is_delivered,
      false
    )                                        AS is_shipped,

    EXISTS (
      SELECT 1 FROM packer_logs pl
      WHERE pl.shipment_id = o.shipment_id
        AND pl.tracking_type = 'ORDERS'
    )                                        AS is_packed,

    EXISTS (
      SELECT 1 FROM tech_serial_numbers tsn
      WHERE tsn.shipment_id = o.shipment_id
    )                                        AS has_tech_scan

FROM orders o
LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
```

For performance-sensitive list queries (large result sets), replace the EXISTS subqueries with lateral joins or CTEs:

```sql
-- Alternative: lateral aggregation (avoids per-row EXISTS re-evaluation)
LEFT JOIN LATERAL (
  SELECT bool_or(pl.tracking_type = 'ORDERS') AS is_packed
  FROM packer_logs pl
  WHERE pl.shipment_id = o.shipment_id
) packing ON true

LEFT JOIN LATERAL (
  SELECT COUNT(*) > 0 AS has_tech_scan
  FROM tech_serial_numbers tsn
  WHERE tsn.shipment_id = o.shipment_id
) tech ON true
```

---

## Phase 5: Remove `orders.is_shipped`

### Prerequisites (must be complete before running)
- [x] Phase 0: Lowercase tracking fix applied
- [x] Phase 1: `scan_ref` added to `packer_logs`
- [ ] Phase 2: All WRITE paths use `shipment_id` — no new rows written with text tracking only
- [ ] Phase 3: All READ paths use FK joins — no queries read `is_shipped` from `orders`
- [ ] Phase 4: `shipping_tracking_number` dropped from `packer_logs` and `tech_serial_numbers`
- [ ] All UI/API consumers of `orders.is_shipped` migrated to derived `is_shipped` from `stn`

### Files to audit before drop

Search for all consumers of `is_shipped` before running:

```bash
rg "is_shipped|isShipped" src/ --type ts -l
```

Known locations:
| File | Current usage | Migration action |
|------|--------------|-----------------|
| `src/components/PendingOrdersTable.tsx` | Reads `order.isShipped` for row display | Replace with derived `isShipped` from JOIN |
| `src/components/UpNextOrder.tsx` | Likely filters or displays shipped state | Replace with derived `isShipped` |
| `src/lib/neon/orders-table-structure.ts` | Defines `ORDER_COLUMNS` and `OrderRecord` | Remove `is_shipped`; add `shipment_status` |
| Any sync/import routes | May SET `is_shipped = true` on ShipStation import | Remove SET; derive instead |

### Migration SQL

```sql
-- 2026-03-11_drop_orders_is_shipped.sql
-- ONLY run after all Phase 5 prerequisites are confirmed complete.
-- Search codebase for `is_shipped` and `isShipped` and confirm zero reads/writes remain.

BEGIN;

-- Safety check: confirm column exists and count rows where true (informational)
DO $$
DECLARE
  shipped_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO shipped_count FROM orders WHERE is_shipped = true;
  RAISE NOTICE 'orders.is_shipped = true on % rows (informational — column is about to be dropped)', shipped_count;
END $$;

ALTER TABLE orders DROP COLUMN IF EXISTS is_shipped;

COMMIT;
```

### Drizzle schema.ts change

```typescript
// BEFORE
export const orders = pgTable('orders', {
  ...
  isShipped: boolean('is_shipped').notNull().default(false),   // ← REMOVE
  ...
});

// AFTER — is_shipped gone; status derives from stn JOIN in every query
export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  orderId: text('order_id'),
  itemNumber: text('item_number'),
  productTitle: text('product_title'),
  sku: text('sku'),
  condition: text('condition'),
  shippingTrackingNumber: text('shipping_tracking_number'),
  shipmentId: bigint('shipment_id', { mode: 'number' }),
  outOfStock: text('out_of_stock'),
  notes: text('notes'),
  quantity: text('quantity').default('1'),
  customerId: integer('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  status: text('status'),
  statusHistory: jsonb('status_history').default([]),
  // is_shipped removed — derive from shipping_tracking_numbers via shipment_id
  accountSource: text('account_source'),
  orderDate: timestamp('order_date'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

### TypeScript interface updates

```typescript
// src/lib/neon/orders-table-structure.ts

// BEFORE
export interface OrderRecord {
  ...
  is_shipped: boolean;   // ← REMOVE
  ...
}

// AFTER — add computed fields returned by FK join
export interface OrderRecord {
  ...
  shipment_id: number | null;
  // Derived from shipping_tracking_numbers JOIN (not stored on orders):
  shipment_status?: string | null;       // stn.latest_status_category
  is_packed?: boolean;                   // derived from packer_logs
  is_shipped?: boolean;                  // derived from stn status
  is_delivered?: boolean;                // stn.is_delivered
  delivered_at?: string | null;          // stn.delivered_at
  carrier?: string | null;               // stn.carrier
  has_exception?: boolean;               // stn.has_exception
  ...
}
```

---

## API Response Field Mapping

Replace the existing `isShipped` boolean with a richer derived object or flat fields:

```typescript
// Outbound API shape (e.g. /api/orders, /api/orders/next)
{
  id: number,
  orderId: string,
  productTitle: string,
  shippingTrackingNumber: string,   // canonical raw tracking (from orders)
  shipmentId: number | null,

  // Derived status — computed in query layer, not stored on orders
  isPacked: boolean,
  isShipped: boolean,
  isDelivered: boolean,
  hasException: boolean,
  shipmentStatus: string | null,    // 'IN_TRANSIT' | 'DELIVERED' | etc.
  carrier: string | null,
  deliveredAt: string | null,
}
```

---

## Summary Table

| What | Action | When |
|------|--------|------|
| `packer_logs.shipping_tracking_number` | Drop (Phase 4 SQL) | After Phase 2+3 verified |
| `tech_serial_numbers.shipping_tracking_number` | Drop (Phase 4 SQL) | After Phase 2+3 verified |
| `orders.is_shipped` | Drop (Phase 5 SQL) | After all consumers migrated |
| `orders.shipping_tracking_number` | **Keep permanently** | Canonical field from ShipStation |
| `orders_exceptions.shipping_tracking_number` | **Keep permanently** | Identity field for exception queue |
| `sku.shipping_tracking_number` | **Keep permanently** | Internal reference |
| `orders.shipment_id` | **Keep permanently** | FK join key |
| `is_shipped` derived flag | Compute in queries via `stn` | After Phase 5 |
| `is_packed` derived flag | Compute via EXISTS on `packer_logs` | After Phase 3 |
| `is_delivered` derived flag | Compute via `stn.is_delivered` | After Phase 3 |

---

## Simple Rule

```
Facts               → event/master tables  (packer_logs, shipping_tracking_numbers, tech_serial_numbers)
Status              → derived in query layer  (EXISTS, FK JOIN, COALESCE)
orders              → order identity + product metadata + FK to shipment
orders.is_shipped   → transitional field; drop once all consumers use stn-derived status
```
