# Orders Table Structure Documentation

## Overview

This document defines the canonical structure of the `orders` table and related tables for tracking order fulfillment.

**Last Updated:** February 6, 2026

---

## Orders Table Schema

The `orders` table is the central table for tracking all orders in the system.

### Core Fields

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| `id` | SERIAL | Primary key | PRIMARY KEY |
| `order_id` | TEXT | External order ID (Amazon, eBay, etc.) | |
| `product_title` | TEXT | Product name/description | |
| `condition` | TEXT | Product condition (New, Refurbished, etc.) | |
| `shipping_tracking_number` | TEXT | Shipping carrier tracking number | |
| `sku` | TEXT | Product SKU | |
| `status_history` | JSONB | Array of status changes with timestamps | DEFAULT [] |
| `is_shipped` | BOOLEAN | Whether order has been shipped | NOT NULL, DEFAULT false |
| `ship_by_date` | TEXT | Date by which order should ship | |
| `packer_id` | INTEGER | Staff ID assigned to pack | FK to staff.id |
| `tester_id` | INTEGER | Staff ID assigned to test | FK to staff.id |
| `notes` | TEXT | Order notes | |
| `quantity` | TEXT | Quantity of items | DEFAULT 1 |
| `out_of_stock` | TEXT | Out of stock status | |
| `account_source` | TEXT | Source account (eBay account, Amazon, FBA, etc.) | |
| `order_date` | TIMESTAMP | Date order was placed | |

### Key Changes (February 2026)

**ADDED:**
- `tester_id` - Assignment tracking for who should test the order

**REMOVED:**
- `packer_photos_url` - Moved to `packer_logs` table
- `pack_date_time` - Moved to `packer_logs` table
- `packed_by` - Moved to `packer_logs` table (completion tracking)

**IMPORTANT:** Assignment vs. Completion
- `packer_id` - Who is **assigned** to pack (in orders table)
- `packed_by` - Who **actually completed** packing (in packer_logs table)
- `tester_id` - Who is **assigned** to test (in orders table)
- `tested_by` - Who **actually completed** testing (derived from tech_serial_numbers table)

---

## Related Tables

### 1. Packer Logs Table

Tracks packing completion events with photos.

**Table:** `packer_logs`

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PRIMARY KEY | |
| `shipping_tracking_number` | TEXT NOT NULL | Links to orders |
| `tracking_type` | VARCHAR(20) NOT NULL | Type of tracking |
| `pack_date_time` | TIMESTAMP | When packing was completed |
| `packed_by` | INTEGER | Staff ID who completed packing (FK to staff.id) |
| `packer_photos_url` | JSONB | Photos from mobile app |
| `created_at` | TIMESTAMP | Record creation time |

**Photo Format (JSONB):**
```json
[
  {
    "url": "blob_storage_url",
    "uploadedAt": "2026-02-06T10:30:00Z",
    "index": 1
  }
]
```

### 2. Tech Serial Numbers Table

Tracks serial numbers and testing for each order.

**Table:** `tech_serial_numbers`

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PRIMARY KEY | |
| `shipping_tracking_number` | TEXT NOT NULL | Links to orders |
| `serial_number` | TEXT NOT NULL | Device serial number |
| `serial_type` | VARCHAR(20) | Type: SERIAL, SKU, FNSKU, etc. |
| `test_date_time` | TIMESTAMP | When testing was completed |
| `tester_id` | INTEGER | Staff ID who completed testing (FK to staff.id) |
| `created_at` | TIMESTAMP | Record creation time |

### 3. Staff Table

Staff/employee information.

**Table:** `staff`

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PRIMARY KEY | |
| `name` | VARCHAR(100) NOT NULL | Staff name |
| `role` | VARCHAR(50) NOT NULL | Role (technician, packer, etc.) |
| `employee_id` | VARCHAR(50) UNIQUE | Employee ID |
| `source_table` | TEXT | Maps to legacy tables |
| `active` | BOOLEAN | Whether staff is active |
| `created_at` | TIMESTAMP | Record creation time |

---

## Status History

The `status_history` field is a JSONB array tracking order status changes:

```json
[
  {
    "status": "unassigned",
    "timestamp": "2026-02-01T08:00:00Z"
  },
  {
    "status": "assigned",
    "timestamp": "2026-02-01T09:15:00Z",
    "previous_status": "unassigned"
  },
  {
    "status": "in_progress",
    "timestamp": "2026-02-01T10:30:00Z",
    "previous_status": "assigned"
  }
]
```

**Common Status Values:**
- `unassigned` - Not yet assigned to any staff
- `assigned` - Assigned to staff but not started
- `in_progress` - Work in progress
- `testing` - Being tested by technician
- `packing` - Being packed
- `shipped` - Completed and shipped

---

## Querying Orders with Related Data

### Get Shipped Orders with All Details

```sql
SELECT 
  o.id,
  o.order_id,
  o.product_title,
  o.condition,
  o.shipping_tracking_number,
  o.sku,
  o.packer_id,
  o.tester_id,
  o.status_history,
  o.is_shipped,
  -- From packer_logs
  pl.packed_by,
  pl.pack_date_time,
  pl.packer_photos_url,
  -- From tech_serial_numbers (aggregated)
  STRING_AGG(tsn.serial_number, ',') as serial_numbers,
  MIN(tsn.tester_id) as tested_by,
  MIN(tsn.test_date_time) as test_date_time
FROM orders o
LEFT JOIN packer_logs pl ON o.shipping_tracking_number = pl.shipping_tracking_number
LEFT JOIN tech_serial_numbers tsn ON o.shipping_tracking_number = tsn.shipping_tracking_number
WHERE o.is_shipped = true
GROUP BY o.id, pl.packed_by, pl.pack_date_time, pl.packer_photos_url
ORDER BY pl.pack_date_time DESC;
```

### Get Staff Names

```sql
SELECT 
  o.*,
  s1.name as packer_name,
  s2.name as tester_name,
  s3.name as packed_by_name,
  s4.name as tested_by_name
FROM orders o
LEFT JOIN staff s1 ON o.packer_id = s1.id
LEFT JOIN staff s2 ON o.tester_id = s2.id
LEFT JOIN packer_logs pl ON o.shipping_tracking_number = pl.shipping_tracking_number
LEFT JOIN staff s3 ON pl.packed_by = s3.id
LEFT JOIN tech_serial_numbers tsn ON o.shipping_tracking_number = tsn.shipping_tracking_number
LEFT JOIN staff s4 ON tsn.tester_id = s4.id;
```

---

## TypeScript Interfaces

### Core Order Interface

```typescript
interface OrderRecord {
  id: number;
  order_id: string | null;
  product_title: string | null;
  condition: string | null;
  shipping_tracking_number: string | null;
  sku: string | null;
  status_history: any; // JSONB
  is_shipped: boolean;
  ship_by_date: string | null;
  packer_id: number | null;
  tester_id: number | null;
  notes: string | null;
  quantity: string | null;
  out_of_stock: string | null;
  account_source: string | null;
  order_date: Date | null;
}
```

### Extended Order with Derived Fields

```typescript
interface OrderWithDerived extends OrderRecord {
  // Derived from packer_logs
  packed_by?: number | null;
  pack_date_time?: string | null;
  packer_photos_url?: any;
  
  // Derived from tech_serial_numbers
  serial_number?: string;
  tested_by?: number | null;
  test_date_time?: string | null;
  
  // Staff names
  packer_name?: string;
  tester_name?: string;
  packed_by_name?: string;
  tested_by_name?: string;
}
```

---

## Migration Notes

### Why These Changes?

1. **Separation of Concerns**: Assignment (`packer_id`, `tester_id`) is separate from completion (`packed_by`, `tested_by`)
2. **Audit Trail**: Packer logs provide a complete history of packing events with photos
3. **Multiple Serials**: Tech serial numbers table supports multiple serial numbers per order
4. **Data Integrity**: Completion data lives in dedicated tables, not mixed with order data

### What This Means for Queries

**Before:**
```sql
SELECT packed_by, pack_date_time FROM orders WHERE id = 123;
```

**After:**
```sql
SELECT pl.packed_by, pl.pack_date_time 
FROM orders o
LEFT JOIN packer_logs pl ON o.shipping_tracking_number = pl.shipping_tracking_number
WHERE o.id = 123;
```

### Backward Compatibility

The `orders-queries.ts` utility functions handle the joins automatically, so existing code using these functions requires no changes:

```typescript
// This still works the same way
const order = await getShippedOrderById(123);
console.log(order.packed_by); // Automatically joined from packer_logs
console.log(order.pack_date_time); // Automatically joined from packer_logs
```

---

## Utilities

### Central Structure File

`src/lib/neon/orders-table-structure.ts` - Single source of truth for orders table structure

### Query Helper

`src/lib/neon/orders-queries.ts` - Pre-built queries that handle all joins automatically:
- `getAllShippedOrders(limit, offset)` - Paginated shipped orders
- `getShippedOrderById(id)` - Single order with all details
- `searchShippedOrders(query)` - Search orders
- `getShippedOrderByTracking(tracking)` - Find by tracking number
- `updateShippedOrderField(id, field, value)` - Update specific fields

---

## Best Practices

1. **Use the Query Helpers**: Don't write raw SQL for orders - use the helper functions
2. **Join Appropriately**: Always join with `packer_logs` and `tech_serial_numbers` when you need completion data
3. **Understand Assignment vs Completion**: `packer_id` is who should pack, `packed_by` is who did pack
4. **Use Transactions**: When updating related tables, use database transactions
5. **Check for NULL**: Completion fields may be NULL if work hasn't been done yet

---

## Common Queries

### Find Unshipped Orders Assigned to Packer

```sql
SELECT * FROM orders 
WHERE packer_id = 2 
AND is_shipped = false;
```

### Find Orders Packed Today

```sql
SELECT o.*, pl.pack_date_time 
FROM orders o
INNER JOIN packer_logs pl ON o.shipping_tracking_number = pl.shipping_tracking_number
WHERE DATE(pl.pack_date_time) = CURRENT_DATE;
```

### Find Orders Missing Serial Numbers

```sql
SELECT o.* FROM orders o
LEFT JOIN tech_serial_numbers tsn ON o.shipping_tracking_number = tsn.shipping_tracking_number
WHERE o.is_shipped = false 
AND tsn.id IS NULL;
```

---

## Support

For questions or issues with the orders table structure:
1. Check this documentation first
2. Review `src/lib/neon/orders-table-structure.ts`
3. Look at existing queries in `src/lib/neon/orders-queries.ts`
4. Check migration files in `src/lib/migrations/`
