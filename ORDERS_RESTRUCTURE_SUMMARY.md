# Orders Table Restructure Summary

**Date:** February 6, 2026  
**Status:** ✅ Complete (No database migration scripts executed)

---

## Overview

Restructured the orders table and related components to:
1. Add `tester_id` field for assignment tracking
2. Remove `packer_photos_url` and `pack_date_time` from orders table
3. Move packing completion data to `packer_logs` table
4. Create central utility for orders table structure

---

## Changes Made

### 1. Created Central Utility File

**File:** `src/lib/neon/orders-table-structure.ts`

- Defines canonical orders table structure
- Provides TypeScript interfaces (`OrderRecord`, `OrderWithDerived`)
- Documents field purposes and relationships
- Exports column name constants
- Includes migration notes and best practices

### 2. Updated Drizzle Schema

**File:** `src/lib/drizzle/schema.ts`

**Changes:**
- ✅ Added `testerId` field (INTEGER, FK to staff.id)
- ❌ Removed `packerPhotosUrl` field
- ❌ Removed `packedBy` field (moved to packer_logs)
- 📝 Updated comments to reflect new structure

**Before:**
```typescript
packedBy: integer('packed_by').references(() => staff.id, { onDelete: 'set null' }),
packerId: integer('packer_id').references(() => staff.id, { onDelete: 'set null' }),
packerPhotosUrl: jsonb('packer_photos_url'),
```

**After:**
```typescript
packerId: integer('packer_id').references(() => staff.id, { onDelete: 'set null' }),
testerId: integer('tester_id').references(() => staff.id, { onDelete: 'set null' }),
// packerPhotosUrl removed - now in packer_logs
// packedBy removed - now in packer_logs
```

### 3. Updated Orders Queries

**File:** `src/lib/neon/orders-queries.ts`

**Changes:**
- Updated `ShippedOrder` interface to include `tester_id`, `packer_id`, `packed_by`
- Modified all queries to join with `packer_logs` table
- Added `LEFT JOIN packer_logs` to get `packed_by`, `pack_date_time`, `packer_photos_url`
- Added staff name joins for `tester_name`
- Updated `updateShippedOrderField()` allowed fields list

**Functions Updated:**
- ✅ `getAllShippedOrders()`
- ✅ `getShippedOrderById()`
- ✅ `searchShippedOrders()`
- ✅ `getShippedOrderByTracking()`
- ✅ `updateShippedOrderField()`
- ✅ `getShippedOrdersCount()`

**Query Pattern:**
```sql
SELECT 
  o.packer_id,
  o.tester_id,
  pl.packed_by,
  pl.pack_date_time,
  pl.packer_photos_url
FROM orders o
LEFT JOIN packer_logs pl ON o.shipping_tracking_number = pl.shipping_tracking_number
LEFT JOIN tech_serial_numbers tsn ON o.shipping_tracking_number = tsn.shipping_tracking_number
```

### 4. Updated API Routes

**Files Modified:**

#### `src/app/api/orders/verify/route.ts`
- Added `LEFT JOIN packer_logs` to get `pack_date_time`
- Checks if order is packed using `pl.pack_date_time`

#### `src/app/api/shipped/submit/route.ts`
- Removed `pack_date_time` from INSERT statement
- No longer inserts packing completion data into orders table

#### `src/app/api/check-tracking/route.ts`
- Added `LEFT JOIN packer_logs` to orders query
- Returns `packer_id`, `tester_id`, `packed_by`, `pack_date_time`
- Updated summary response to include new fields

### 5. Created Documentation

**Files:**

#### `ORDERS_TABLE_STRUCTURE.md`
Comprehensive documentation including:
- Full schema definition
- Related tables (packer_logs, tech_serial_numbers, staff)
- Status history format
- SQL query examples
- TypeScript interfaces
- Migration notes
- Best practices
- Common queries

#### `ORDERS_RESTRUCTURE_SUMMARY.md` (this file)
Summary of changes made

---

## New Table Structure

### Orders Table (Current State)

| Column | Type | Purpose |
|--------|------|---------|
| `id` | SERIAL PRIMARY KEY | Unique identifier |
| `order_id` | TEXT | External order number |
| `product_title` | TEXT | Product name |
| `condition` | TEXT | Product condition |
| `shipping_tracking_number` | TEXT | Tracking number |
| `sku` | TEXT | Product SKU |
| `status_history` | JSONB | Status change log |
| `is_shipped` | BOOLEAN | Shipped status |
| `ship_by_date` | TEXT | Ship deadline |
| `packer_id` | INTEGER | **Assignment**: Who should pack |
| `tester_id` | INTEGER | **✨ NEW - Assignment**: Who should test |
| `notes` | TEXT | Order notes |
| `quantity` | TEXT | Item quantity |
| `out_of_stock` | TEXT | Stock status |
| `account_source` | TEXT | Source marketplace |
| `order_date` | TIMESTAMP | Order creation date |

### Packer Logs Table (Related)

Stores packing completion data:
- `packed_by` - Who completed packing
- `pack_date_time` - When packing was completed  
- `packer_photos_url` - Photos from mobile app

### Key Concepts

**Assignment vs. Completion:**
- `packer_id` (orders) = Who is **assigned** to pack
- `packed_by` (packer_logs) = Who **completed** packing
- `tester_id` (orders) = Who is **assigned** to test
- `tested_by` (tech_serial_numbers) = Who **completed** testing

---

## Backward Compatibility

### ✅ Existing Code Still Works

The query helper functions in `orders-queries.ts` handle all joins automatically:

```typescript
// This code doesn't need to change
const order = await getShippedOrderById(123);

// These fields are still available (joined from packer_logs)
console.log(order.packed_by);
console.log(order.pack_date_time);
console.log(order.packer_photos_url);

// New field now available
console.log(order.tester_id);
```

### ⚠️ Direct SQL Queries Need Updates

If you have raw SQL queries that reference `orders.packed_by` or `orders.pack_date_time`, they need to be updated to join with `packer_logs`:

```sql
-- OLD (will fail)
SELECT packed_by, pack_date_time FROM orders WHERE id = 123;

-- NEW (correct)
SELECT pl.packed_by, pl.pack_date_time 
FROM orders o
LEFT JOIN packer_logs pl ON o.shipping_tracking_number = pl.shipping_tracking_number
WHERE o.id = 123;
```

---

## Database Migration

### ⚠️ IMPORTANT: No Migration Scripts Executed

Per user request, **NO database migration scripts were run**. The following changes need to be made manually to the database when ready:

```sql
-- Add tester_id column
ALTER TABLE orders 
  ADD COLUMN IF NOT EXISTS tester_id INTEGER 
  REFERENCES staff(id) ON DELETE SET NULL;

-- Remove old columns (if they exist in database)
ALTER TABLE orders DROP COLUMN IF EXISTS packer_photos_url;
ALTER TABLE orders DROP COLUMN IF EXISTS pack_date_time;
ALTER TABLE orders DROP COLUMN IF EXISTS packed_by;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_orders_tester_id ON orders(tester_id);
```

**Note:** The code is ready to work with the new structure. Execute the above SQL when ready to migrate the database schema.

---

## Testing Checklist

Before deploying to production:

- [ ] Execute database migration SQL
- [ ] Test `getAllShippedOrders()` - verify packer_logs join works
- [ ] Test `getShippedOrderById()` - verify all fields present
- [ ] Test `searchShippedOrders()` - verify search includes packer_logs data
- [ ] Test order assignment with `tester_id`
- [ ] Test packing completion flow (creates packer_logs entry)
- [ ] Verify shipped orders display correctly in UI
- [ ] Check that photos display correctly (from packer_logs)
- [ ] Verify staff name lookups work for all roles
- [ ] Test backward compatibility with existing orders

---

## Files Modified

### Core Files
- ✅ `src/lib/neon/orders-table-structure.ts` (NEW)
- ✅ `src/lib/drizzle/schema.ts`
- ✅ `src/lib/neon/orders-queries.ts`

### API Routes
- ✅ `src/app/api/orders/verify/route.ts`
- ✅ `src/app/api/shipped/submit/route.ts`
- ✅ `src/app/api/check-tracking/route.ts`

### Documentation
- ✅ `ORDERS_TABLE_STRUCTURE.md` (NEW)
- ✅ `ORDERS_RESTRUCTURE_SUMMARY.md` (NEW - this file)

### Components (No Changes Needed)
- `src/components/shipped/ShippedTable.tsx` - Uses interface, no changes needed
- `src/components/shipped/ShippedDetailsPanel.tsx` - Uses interface, no changes needed

---

## Next Steps

1. **Review Changes**
   - Review all modified files
   - Verify query logic is correct
   - Check TypeScript types are consistent

2. **Database Migration** (when ready)
   - Backup database
   - Execute migration SQL
   - Verify columns added/removed correctly
   - Test queries against new schema

3. **Testing**
   - Unit test query functions
   - Integration test API endpoints
   - Manual test UI components
   - Verify data integrity

4. **Deployment**
   - Deploy code changes
   - Monitor error logs
   - Verify no breaking changes
   - Check performance metrics

---

## Support & References

- **Structure Definition:** `src/lib/neon/orders-table-structure.ts`
- **Query Helpers:** `src/lib/neon/orders-queries.ts`
- **Full Documentation:** `ORDERS_TABLE_STRUCTURE.md`
- **Schema File:** `src/lib/drizzle/schema.ts`

For questions or issues, refer to these files first.
