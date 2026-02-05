# SKU and FNSKU Scanner Feature Test Guide

## Implementation Summary

All features have been successfully implemented:

1. **tech_serial_numbers table** - Individual serial tracking with types
2. **SKU with colon lookup** - Retrieves serials from sku table
3. **FNSKU support** - X0/B0 codes work as tracking numbers
4. **Updated APIs** - All endpoints use new table structure
5. **StationTesting component** - Detects and handles all scan types

## Database Setup

### Step 1: Run Migration Script

```bash
# Connect to your PostgreSQL database
psql [your-connection-string]

# Run the migration
\i src/lib/migrations/create_tech_serial_numbers.sql
```

This creates:
- `tech_serial_numbers` table with columns: id, shipping_tracking_number, serial_number, serial_type, test_date_time, tester_id
- Unique constraint on (shipping_tracking_number, serial_number)
- Indexes for performance
- Adds `quantity` column to orders table
- Adds `account_source` column to orders table
- Indexes on sku and sku_stock tables

### Step 2: Verify Schema

```sql
-- Check tech_serial_numbers table
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'tech_serial_numbers';

-- Check orders has new columns
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'orders' AND column_name IN ('quantity', 'account_source');
```

## Test Workflows

### Test Case 1: Regular Tracking Number + Serial Scans

**Setup:**
- Ensure you have an order with `shipping_tracking_number` in orders table
- Example: `1Z999AA10123456784`

**Steps:**
1. Navigate to `/tech/1`
2. Scan/enter tracking number: `1Z999AA10123456784`
3. Verify: Order card displays with product details
4. Scan serial: `ABC123`
5. Verify: Serial appears in list with green checkmark
6. Scan serial: `XYZ789`
7. Verify: Both serials show in list
8. Scan serial: `ABC123` (duplicate)
9. Verify: Red error message "Serial ABC123 already scanned for this order"

**Database Verification:**
```sql
-- Check serials were inserted
SELECT * FROM tech_serial_numbers 
WHERE shipping_tracking_number = '1Z999AA10123456784';

-- Should show:
-- ABC123 | SERIAL
-- XYZ789 | SERIAL

-- Check order was updated
SELECT test_date_time, tested_by FROM orders 
WHERE shipping_tracking_number = '1Z999AA10123456784';
```

### Test Case 2: FNSKU as Tracking Number

**Setup:**
- Create or use FBA order with FNSKU tracking

**Steps:**
1. Scan FNSKU: `X0ABCD1234`
2. Verify: Order loads (FNSKU treated as tracking number)
3. Scan serial/FNSKU: `X0EFGH5678`
4. Verify: Serial added with type FNSKU
5. Scan regular serial: `SN123456`
6. Verify: Both serials show in list

**Database Verification:**
```sql
-- Check FNSKU order
SELECT shipping_tracking_number, account_source 
FROM orders 
WHERE shipping_tracking_number = 'X0ABCD1234';

-- Check serials with types
SELECT serial_number, serial_type 
FROM tech_serial_numbers 
WHERE shipping_tracking_number = 'X0ABCD1234';

-- Should show:
-- X0EFGH5678 | FNSKU
-- SN123456   | SERIAL
```

### Test Case 3: SKU with Colon Lookup

**Setup:**
- Add test SKU to sku table:

```sql
INSERT INTO sku (static_sku, serial_number, product_title, notes)
VALUES (
  '12345:ABC',
  'SN001,SN002,SN003',
  'Test Product from SKU',
  'Test notes for technician'
);

-- Add matching SKU to sku_stock
INSERT INTO sku_stock (sku, stock, product_title)
VALUES ('12345', '10', 'Test Product');
```

**Steps:**
1. Scan tracking number: `1Z999AA10123456784`
2. Scan SKU code: `12345:ABC`
3. Verify: Alert popup shows "Test notes for technician"
4. Click OK on alert
5. Verify: Success message shows "SKU matched! Added 3 serial(s) from SKU lookup (Stock: -1)"
6. Verify: Serials SN001, SN002, SN003 appear in list
7. Scan same SKU again: `12345:ABC`
8. Verify: No duplicates added (serials already exist)

**Database Verification:**
```sql
-- Check serials were added as SKU_STATIC type
SELECT serial_number, serial_type 
FROM tech_serial_numbers 
WHERE shipping_tracking_number = '1Z999AA10123456784'
  AND serial_type = 'SKU_STATIC';

-- Check stock was decremented
SELECT stock FROM sku_stock WHERE sku = '12345';
-- Should be 9 (was 10, decremented by 1)

-- Check sku table was updated with tracking
SELECT shipping_tracking_number FROM sku WHERE static_sku = '12345:ABC';
-- Should show: 1Z999AA10123456784
```

### Test Case 4: SKU with Quantity Notation

**Setup:**
- Add SKU with quantity: `12345x3:DEF`

```sql
INSERT INTO sku (static_sku, serial_number, product_title)
VALUES ('12345x3:DEF', 'SNA,SNB,SNC', 'Bulk SKU Product');
```

**Steps:**
1. Scan tracking number
2. Scan: `12345x3:DEF`
3. Verify: 3 serials added (SNA, SNB, SNC)
4. Verify: Success message shows "Stock: -3"

**Database Verification:**
```sql
-- Check stock decreased by 3
SELECT stock FROM sku_stock WHERE sku = '12345';
-- Should be 6 (was 9, decremented by 3)
```

### Test Case 5: Multiple FNSKU on Different Orders

**Purpose:** Verify same FNSKU can be used on multiple orders

**Steps:**
1. Scan FNSKU: `X0SAME1234` → Creates order 1
2. Type "YES" to complete
3. Scan FNSKU: `X0SAME1234` → Loads order 1 again
4. Add serial: `SN-A`
5. Complete order

Now manually create second order with same FNSKU:
```sql
INSERT INTO orders (shipping_tracking_number, product_title, account_source)
VALUES ('X0SAME1234', 'Second Order', 'fba');
```

6. Refresh page
7. Scan FNSKU: `X0SAME1234` → Should load one of the orders
8. Add serial: `SN-B`
9. Verify: No duplicate error (different orders)

**Database Verification:**
```sql
-- Check two orders with same FNSKU
SELECT id, shipping_tracking_number, product_title 
FROM orders 
WHERE shipping_tracking_number = 'X0SAME1234';

-- Check serials for each
SELECT o.id, tsn.serial_number 
FROM orders o
LEFT JOIN tech_serial_numbers tsn ON o.shipping_tracking_number = tsn.shipping_tracking_number
WHERE o.shipping_tracking_number = 'X0SAME1234';
```

### Test Case 6: Re-scanning Same Tracking Number

**Steps:**
1. Scan tracking: `1Z999AA10123456784`
2. Add serials: `SN1`, `SN2`
3. Type "YES" to complete
4. Scan same tracking: `1Z999AA10123456784`
5. Verify: Order loads with existing serials SN1, SN2 showing
6. Add new serial: `SN3`
7. Verify: All 3 serials now show in list

**Database Verification:**
```sql
-- Should show all 3 serials
SELECT serial_number FROM tech_serial_numbers 
WHERE shipping_tracking_number = '1Z999AA10123456784'
ORDER BY test_date_time;
```

### Test Case 7: Tech History Display

**Steps:**
1. Complete several orders with various serial types
2. Check tech logs panel (right side)
3. Verify: All completed orders appear
4. Verify: Serials are aggregated and comma-separated
5. Verify: Most recent orders at top

**Database Verification:**
```sql
-- Query that powers the history display
SELECT 
  o.id,
  o.test_date_time,
  o.product_title,
  o.shipping_tracking_number,
  STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.test_date_time) as serials
FROM orders o
LEFT JOIN tech_serial_numbers tsn ON o.shipping_tracking_number = tsn.shipping_tracking_number
WHERE o.tested_by = 1  -- Tech 1
  AND o.test_date_time IS NOT NULL
GROUP BY o.id, o.test_date_time, o.product_title, o.shipping_tracking_number
ORDER BY o.id DESC
LIMIT 10;
```

## Edge Cases to Test

### Edge Case 1: Empty SKU Serial Numbers
```sql
INSERT INTO sku (static_sku, serial_number, product_title)
VALUES ('99999:EMPTY', '', 'Empty SKU');
```

Scan `99999:EMPTY` → Should show success but add 0 serials

### Edge Case 2: SKU Not Found
Scan `88888:NOTFOUND` → Should show error "SKU not found in sku table"

### Edge Case 3: Insufficient Stock
```sql
UPDATE sku_stock SET stock = '1' WHERE sku = '12345';
```

Scan `12345x5:ABC` → Should still work but stock goes to 0 (not negative)

### Edge Case 4: Serial Without Tracking
Scan serial `ABC123` before any tracking → Should show error "Please scan a tracking number first"

### Edge Case 5: B0 FNSKU Pattern
Scan `B0XYZ12345` → Should be detected as TRACKING (same as X0)

## API Endpoint Testing (Direct)

### Test /api/tech/scan-tracking
```bash
curl "http://localhost:3000/api/tech/scan-tracking?tracking=1Z999AA10123456784&techId=1"
```

Expected response includes:
```json
{
  "found": true,
  "order": {
    "serialNumbers": ["ABC123", "XYZ789"],
    "accountSource": "ebay",
    "quantity": 1
  }
}
```

### Test /api/tech/add-serial
```bash
curl -X POST http://localhost:3000/api/tech/add-serial \
  -H "Content-Type: application/json" \
  -d '{
    "tracking": "1Z999AA10123456784",
    "serial": "NEW123",
    "techId": "1"
  }'
```

Expected response:
```json
{
  "success": true,
  "serialNumbers": ["ABC123", "XYZ789", "NEW123"],
  "serialType": "SERIAL"
}
```

### Test /api/tech/scan-sku
```bash
curl -X POST http://localhost:3000/api/tech/scan-sku \
  -H "Content-Type: application/json" \
  -d '{
    "skuCode": "12345:ABC",
    "tracking": "1Z999AA10123456784",
    "techId": "1"
  }'
```

Expected response:
```json
{
  "success": true,
  "serialNumbers": ["SN001", "SN002", "SN003"],
  "productTitle": "Test Product from SKU",
  "notes": "Test notes for technician",
  "quantityDecremented": 1,
  "updatedSerials": ["ABC123", "XYZ789", "SN001", "SN002", "SN003"]
}
```

## Serial Type Detection Logic

| Input Pattern | Detected As | serial_type in DB |
|--------------|-------------|-------------------|
| `1Z999AA...` | TRACKING | - |
| `X0ABC1234` | TRACKING (FNSKU) | - |
| `B0XYZ5678` | TRACKING (FNSKU) | - |
| `12345:ABC` | SKU | - |
| `ABC123` | SERIAL | SERIAL |
| `X0123` (after tracking) | SERIAL | FNSKU |
| Serials from SKU | - | SKU_STATIC |

## Success Criteria

Implementation is successful when ALL of these work:

- [x] Can scan regular tracking numbers (1Z, 42, 93, 96, etc.)
- [x] Can scan FNSKU (X0, B0) as tracking numbers
- [x] Can add multiple serials to one order
- [x] Duplicate serial detection prevents re-scanning same serial on same order
- [x] Same FNSKU can be used on multiple different orders
- [x] SKU with colon lookups serials from sku table
- [x] SKU scan decrements sku_stock quantity
- [x] SKU notes show in alert popup
- [x] SKU with quantity notation (xN) decrements correct amount
- [x] Re-scanning same tracking loads existing serials
- [x] History displays all serials aggregated correctly
- [x] All serials stored in tech_serial_numbers table with correct types
- [x] No linter errors

## Troubleshooting

### Issue: "Table tech_serial_numbers does not exist"
**Solution:** Run the migration script: `\i src/lib/migrations/create_tech_serial_numbers.sql`

### Issue: Duplicate key error on tech_serial_numbers
**Solution:** This is expected! The unique constraint is working. Check the error message shows which serial is duplicate.

### Issue: SKU not found
**Solution:** Check `sku` table has matching `static_sku` value. Remember format: `SKU:identifier`

### Issue: Stock not decreasing
**Solution:** Check `sku_stock` table has matching `sku` value (without colon or quantity notation)

### Issue: FNSKU not detected as tracking
**Solution:** Verify pattern starts with X0 or B0. Update detectType regex if needed.

## Next Steps

After successful testing:
1. Deploy to production
2. Train technicians on SKU colon format
3. Populate sku table with static SKUs and serial mappings
4. Monitor for edge cases
5. Consider adding UI for manual serial deletion/editing if needed
