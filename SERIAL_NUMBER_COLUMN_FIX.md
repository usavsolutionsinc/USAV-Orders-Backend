# Serial Number Column Fix

## Issue
When testing the verify orders feature on the mobile app, the backend was throwing an error:
```
Error fetching next order: error: column "serial_number" does not exist
```

This error occurred regardless of whether the order was marked as `is_shipped = true` or `false`.

## Root Cause
The `serial_number` column was removed from the `orders` table as part of a database schema update. Serial numbers are now stored in the separate `tech_serial_numbers` table. However, several backend API endpoints were still trying to query the `serial_number` column from the `orders` table.

## Database Schema Change
The `orders` table no longer has a `serial_number` column. The current schema includes:
- id
- pack_date_time
- order_id
- product_title
- condition
- shipping_tracking_number
- sku
- status
- status_history
- is_shipped
- ship_by_date
- packer_id
- packed_by
- packer_photos_url
- notes
- quantity
- out_of_stock
- account_source
- order_date

Serial numbers are now tracked in the `tech_serial_numbers` table with fields:
- id
- shipping_tracking_number
- serial_number
- serial_type
- test_date_time
- tester_id

## Files Fixed

### 1. `/src/app/api/orders/next/route.ts`
**Problem**: Line 45 was selecting `serial_number` from orders table in the SELECT statement.

**Fix**: Removed `serial_number` from the SELECT query.

**Before:**
```sql
SELECT 
  id,
  ship_by_date,
  order_id,
  product_title,
  sku,
  status,
  condition,
  shipping_tracking_number,
  serial_number,  -- ❌ REMOVED
  out_of_stock
FROM orders
```

**After:**
```sql
SELECT 
  id,
  ship_by_date,
  order_id,
  product_title,
  sku,
  status,
  condition,
  shipping_tracking_number,
  out_of_stock
FROM orders
```

### 2. `/src/app/api/sync-sheets/route.ts`
**Problem**: The Google Sheets sync endpoint was trying to update and insert `serial_number` into the orders table.

**Fixes Applied:**

#### UPDATE Query (Line 216-230)
- Removed `serial_number` from UPDATE statement
- Removed `tested_by` from UPDATE (testing is now tracked in tech_serial_numbers)
- Added `quantity` to the UPDATE to match schema
- Adjusted parameter order ($1-$9)

**Before:**
```sql
UPDATE orders
SET 
  order_id = COALESCE(NULLIF($1, ''), order_id),
  product_title = COALESCE(NULLIF($2, ''), product_title),
  condition = COALESCE(NULLIF($3, ''), condition),
  serial_number = COALESCE(NULLIF($4, ''), serial_number),  -- ❌ REMOVED
  sku = COALESCE(NULLIF($5, ''), sku),
  packed_by = COALESCE($6, packed_by),
  tested_by = COALESCE($7, tested_by),  -- ❌ REMOVED
  pack_date_time = COALESCE(NULLIF($8, ''), pack_date_time),
  is_shipped = CASE WHEN $8 != '' THEN true ELSE is_shipped END,
  status_history = $9::jsonb
WHERE shipping_tracking_number = $10
```

**After:**
```sql
UPDATE orders
SET 
  order_id = COALESCE(NULLIF($1, ''), order_id),
  product_title = COALESCE(NULLIF($2, ''), product_title),
  condition = COALESCE(NULLIF($3, ''), condition),
  sku = COALESCE(NULLIF($4, ''), sku),
  packed_by = COALESCE($5, packed_by),
  pack_date_time = COALESCE(NULLIF($6, ''), pack_date_time),
  is_shipped = CASE WHEN $6 != '' THEN true ELSE is_shipped END,
  status_history = $7::jsonb,
  quantity = COALESCE(NULLIF($8, ''), quantity)  -- ✅ ADDED
WHERE shipping_tracking_number = $9
```

#### INSERT Query (Line 245-253)
- Removed `serial_number` from INSERT statement
- Removed `tested_by` from INSERT (testing is now tracked in tech_serial_numbers)
- Added `quantity` to match schema
- Adjusted parameter order ($1-$11)

**Before:**
```sql
INSERT INTO orders (
  order_id, product_title, condition, shipping_tracking_number,
  serial_number, sku, packed_by, tested_by, pack_date_time,  -- ❌ serial_number, tested_by
  is_shipped, status, status_history
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
```

**After:**
```sql
INSERT INTO orders (
  order_id, product_title, condition, shipping_tracking_number,
  sku, packed_by, pack_date_time, quantity,  -- ✅ quantity added
  is_shipped, status, status_history
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
```

## Testing Notes

### For Serial Number Tracking
Serial numbers are now managed through dedicated endpoints:
- `POST /api/tech/add-serial` - Add serial number to tech_serial_numbers table
- `GET /api/tech/scan-tracking` - Get order with all serial numbers from tech_serial_numbers
- `POST /api/sync-sheets-to-tech-serials` - Sync tech sheet data to tech_serial_numbers

### Verify Orders Feature
The mobile app's verify orders feature should now work correctly:
1. Scan shipping label barcode
2. System checks if order exists in database
3. No more `serial_number does not exist` errors

## Migration Impact
- ✅ Old orders with serial numbers in the orders table remain readable (column just not queried)
- ✅ New orders store serial numbers in tech_serial_numbers table
- ✅ All serial number operations go through tech_serial_numbers table
- ✅ Backward compatible with existing data

## Related Documentation
- See `SCANNER_UPGRADE_SUMMARY.md` for details on tech_serial_numbers table migration
- See `ORDER_VERIFICATION_FEATURE.md` for mobile app verify orders documentation
