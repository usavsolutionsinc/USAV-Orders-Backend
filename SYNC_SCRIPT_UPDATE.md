# Sync Script Update Summary

**Date:** February 6, 2026  
**Status:** ✅ Complete

---

## Overview

Completely rewrote the Google Sheets → Database sync script to:
1. **TRUNCATE (delete all data)** before syncing
2. Update column mappings for new orders table structure
3. Properly distribute data across `orders`, `packer_logs`, and `tech_serial_numbers` tables

---

## Key Changes

### 1. **Truncate Strategy**

**Before:** Upsert/update existing records  
**After:** Complete truncate and replace

```sql
-- These tables are now TRUNCATED before syncing
TRUNCATE TABLE orders RESTART IDENTITY CASCADE;
TRUNCATE TABLE packer_logs RESTART IDENTITY CASCADE;
TRUNCATE TABLE tech_serial_numbers RESTART IDENTITY CASCADE;
TRUNCATE TABLE sku_stock RESTART IDENTITY CASCADE;
TRUNCATE TABLE sku RESTART IDENTITY CASCADE;
```

### 2. **Sheet Processing Order**

1. **Shipped Sheet** - Truncates and populates orders, packer_logs, tech_serial_numbers
2. **Tech Sheets (tech_1, tech_2, tech_3)** - Appends to tech_serial_numbers
3. **Packer Sheets (packer_1, packer_2)** - Appends to packer_logs
4. **SKU-Stock Sheet** - Truncates and replaces sku_stock table
5. **SKU Sheet** - Truncates and replaces sku table

---

## Column Mappings

### 📊 Shipped Sheet (A-L) → Multiple Tables

| Column | Data | Target Table | Field |
|--------|------|--------------|-------|
| A | Pack date/time | `packer_logs` | `pack_date_time` |
| B | Order ID | `orders` | `order_id` |
| C | Product title | `orders` | `product_title` |
| D | Quantity | `orders` | `quantity` |
| E | Condition | `orders` | `condition` |
| F | Tracking number | `orders` | `shipping_tracking_number` |
| G | Serial number | `tech_serial_numbers` | `serial_number` |
| H | Packer name | `packer_logs` | `packed_by` (4=Tuan, 5=Thuy) |
| I | Tester name | `tech_serial_numbers` | `tested_by` (1=Mike, 2=Thuc, 3=Sang) |
| J | Ship by date | `orders` | `ship_by_date` |
| K | SKU | `orders` | `sku` |
| L | Notes | `orders` | `notes` |

**Processing Logic:**
1. Creates base order record in `orders` table
2. If pack_date_time + packed_by exist → creates `packer_logs` entry
3. If serial_number + tested_by exist → creates `tech_serial_numbers` entry

### 🔧 Tech Sheets (tech_1, tech_2, tech_3) → tech_serial_numbers

**Staff ID Mapping:**
- tech_1 → tester_id = 1 (Mike/Michael)
- tech_2 → tester_id = 2 (Thuc)
- tech_3 → tester_id = 3 (Sang)

| Column | Field |
|--------|-------|
| A | `test_date_time` |
| C | `shipping_tracking_number` (JOIN with orders) |
| D | `serial_number` |

**Processing:**
- Only inserts if matching order exists in `orders` table
- Uses `ON CONFLICT DO NOTHING` to avoid duplicates

### 📦 Packer Sheets (packer_1, packer_2) → packer_logs

**Staff ID Mapping:**
- packer_1 → packed_by = 4 (Tuan)
- packer_2 → packed_by = 5 (Thuy)

| Column | Field |
|--------|-------|
| A | `pack_date_time` |
| B | `shipping_tracking_number` (JOIN with orders) |

**Processing:**
- Only inserts if matching order exists in `orders` table
- Uses `ON CONFLICT DO NOTHING` to avoid duplicates

### 📋 SKU-Stock Sheet → sku_stock

| Column | Field |
|--------|-------|
| A | `stock` |
| B | `sku` |
| C | `size` |
| D | `product_title` |

### 🏷️ SKU Sheet → sku

| Column | Field |
|--------|-------|
| A | `date_time` |
| B | `static_sku` |
| C | `serial_number` |
| D | `shipping_tracking_number` |
| E | `product_title` |
| F | `notes` |
| G | `location` |

---

## Staff Name Mappings

### Packers
```typescript
const packerNameMap = {
  'TUAN': 4, 'Tuan': 4, 'tuan': 4,
  'THUY': 5, 'Thuy': 5, 'thuy': 5
};
```

### Testers
```typescript
const techNameMap = {
  'MIKE': 1, 'Mike': 1, 'mike': 1,
  'MICHAEL': 1, 'Michael': 1, 'michael': 1,
  'THUC': 2, 'Thuc': 2, 'thuc': 2,
  'SANG': 3, 'Sang': 3, 'sang': 3
};
```

---

## Data Flow

```
Google Sheets
    │
    ├─► Shipped Sheet
    │   ├─► orders table (base data)
    │   ├─► packer_logs (if packed)
    │   └─► tech_serial_numbers (if tested)
    │
    ├─► Tech Sheets (tech_1/2/3)
    │   └─► tech_serial_numbers (append)
    │
    ├─► Packer Sheets (packer_1/2)
    │   └─► packer_logs (append)
    │
    ├─► SKU-Stock Sheet
    │   └─► sku_stock (replace)
    │
    └─► SKU Sheet
        └─► sku (replace)
```

---

## Important Behaviors

### 🔄 Truncate vs Append

**TRUNCATE (Replace All):**
- `orders` - Completely replaced from shipped sheet
- `packer_logs` - Initially truncated with orders, then tech/packer sheets append
- `tech_serial_numbers` - Initially truncated with orders, then tech sheets append
- `sku_stock` - Completely replaced
- `sku` - Completely replaced

**APPEND (Add Only):**
- Tech sheets add to `tech_serial_numbers` after initial truncate
- Packer sheets add to `packer_logs` after initial truncate

### ✅ Validation

**Shipped Sheet:**
- Skips rows without `shipping_tracking_number`

**Tech Sheets:**
- Only inserts if matching order exists
- Skips if missing `shipping_tracking_number` or `serial_number`

**Packer Sheets:**
- Only inserts if matching order exists
- Skips if missing `shipping_tracking_number` or `pack_date_time`

### 🔑 Key Fields

**Assignment vs Completion:**
- `orders.packer_id` - Set from column H (who should pack)
- `packer_logs.packed_by` - Set from column H (who completed packing)
- `orders.tester_id` - Set from column I (who should test)
- `tech_serial_numbers.tester_id` - Set from column I or sheet name (who completed testing)

---

## Response Format

```json
{
  "success": true,
  "message": "Sync process completed - all tables truncated and replaced",
  "results": [
    {
      "sheet": "shipped",
      "tables": "orders, packer_logs, tech_serial_numbers",
      "status": "replaced",
      "rows": 150
    },
    {
      "sheet": "tech_1",
      "table": "tech_serial_numbers",
      "status": "synced",
      "rows": 45
    },
    {
      "sheet": "packer_1",
      "table": "packer_logs",
      "status": "synced",
      "rows": 50
    },
    {
      "sheet": "sku-stock",
      "table": "sku_stock",
      "status": "replaced",
      "rows": 200
    },
    {
      "sheet": "sku",
      "table": "sku",
      "status": "replaced",
      "rows": 300
    }
  ],
  "timestamp": "2026-02-06T10:30:00.000Z"
}
```

---

## Error Handling

Each sheet sync is wrapped in try-catch:
- Errors don't stop the entire sync
- Failed sheets return error status in results
- Successful sheets continue processing

Example error response:
```json
{
  "sheet": "shipped",
  "status": "error",
  "error": "Column mismatch: expected 12 columns, got 10"
}
```

---

## Database Transactions

### Shipped Sheet
```sql
BEGIN;
  TRUNCATE TABLE orders CASCADE;
  TRUNCATE TABLE packer_logs CASCADE;
  TRUNCATE TABLE tech_serial_numbers CASCADE;
  -- Insert all data
COMMIT; -- or ROLLBACK on error
```

### SKU-Stock & SKU Sheets
```sql
BEGIN;
  TRUNCATE TABLE sku_stock CASCADE;
  -- Insert all data
COMMIT; -- or ROLLBACK on error
```

### Tech & Packer Sheets
- No transaction (individual inserts with ON CONFLICT)
- Doesn't rollback on single row failure

---

## Testing Checklist

Before running in production:

- [ ] Backup database
- [ ] Test with small dataset first
- [ ] Verify staff ID mappings are correct
- [ ] Check date/time formats match expected format
- [ ] Confirm all sheet names are correct
- [ ] Verify column positions match documentation
- [ ] Test with missing/null values
- [ ] Verify foreign key relationships work
- [ ] Check CASCADE behavior on truncate
- [ ] Monitor sync completion time

---

## Performance Notes

- **Timeout:** 60 seconds (Vercel maxDuration)
- **Batch Size:** All rows processed in single transaction per sheet
- **Indexes:** Foreign keys should have indexes for JOIN performance
- **Cascade:** TRUNCATE CASCADE automatically clears dependent records

---

## Migration from Old Script

### What Changed

**Removed:**
- Dynamic table matching for orders/tech/packer sheets
- Update/upsert logic for existing records
- Separate sync-sheets-to-tech-serials endpoint

**Added:**
- Truncate before sync
- Multi-table inserts from shipped sheet
- Proper assignment vs completion tracking
- Staff name to ID mapping
- Enhanced error reporting

### Backward Compatibility

⚠️ **Breaking Changes:**
- Old data will be DELETED on sync
- Column positions must match exactly
- Staff names must match mapping

✅ **Compatible:**
- Same API endpoint (`/api/sync-sheets`)
- Same request format
- Similar response format

---

## Support

**File:** `src/app/api/sync-sheets/route.ts`  
**Related Docs:**
- `ORDERS_TABLE_STRUCTURE.md` - Orders table schema
- `ORDERS_RESTRUCTURE_SUMMARY.md` - Recent changes

For issues:
1. Check column mappings in Google Sheets
2. Verify staff name spellings
3. Review error messages in response
4. Check database logs for constraint violations
