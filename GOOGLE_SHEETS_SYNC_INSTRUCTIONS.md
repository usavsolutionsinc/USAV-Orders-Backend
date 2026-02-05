# Google Sheets Sync Instructions

## Overview

The tech scanner system can sync test data from Google Sheets to the `tech_serial_numbers` table. This is useful for importing historical data or syncing data entered manually in Google Sheets.

## Current Status

### ✅ Data Already Synced
- **1,230 serials** in `tech_serial_numbers` table
- **100% coverage** - all serials have `tester_id` set
- No immediate sync needed

### ✅ Database Cleanup Complete
- `tester_id` removed from `orders` table
- All test tracking now in `tech_serial_numbers` table
- Schema fully optimized

## When to Run Sync

Run the Google Sheets sync when:
- New tech sheet data has been entered in Google Sheets
- You want to update `test_date_time` from sheets
- You want to update `tester_id` from sheets
- You're adding historical data from old sheets

## How to Run Sync

### Method 1: API Call (Command Line)

Start your dev server first:
```bash
npm run dev
```

Then in another terminal:
```bash
curl -X POST http://localhost:3000/api/sync-sheets-to-tech-serials \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Method 2: API Call (Custom Spreadsheet)

If using a different Google Sheet:
```bash
curl -X POST http://localhost:3000/api/sync-sheets-to-tech-serials \
  -H "Content-Type: application/json" \
  -d '{"spreadsheetId": "YOUR_SPREADSHEET_ID"}'
```

### Method 3: From Browser/Admin Panel

If you have an admin UI, add a sync button:
```typescript
async function syncFromGoogleSheets() {
  const response = await fetch('/api/sync-sheets-to-tech-serials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  
  const result = await response.json();
  console.log(result);
}
```

## What Gets Synced

### Tech Sheets Structure
- **tech_1** → Mike (TECH001)
- **tech_2** → Thuc (TECH002)
- **tech_3** → Sang (TECH003)
- **tech_4** → Cuong (TECH004)

### Columns in Google Sheets
```
Column A: Date/Time (e.g., "2/5/2026 14:30:00")
Column B: (unused)
Column C: Tracking Number
Column D: Serial Number
```

### Data Synced to tech_serial_numbers
For each row in tech sheets:
- `shipping_tracking_number` from Column C
- `serial_number` from Column D (uppercased)
- `test_date_time` from Column A (parsed)
- `tester_id` from tech sheet name (tech_1 = Mike, etc.)
- `serial_type` detected (SERIAL or FNSKU)

## Expected Response

```json
{
  "success": true,
  "message": "Tech sheets synced to tech_serial_numbers table",
  "results": [
    {
      "sheet": "tech_1",
      "techName": "Mike",
      "status": "synced",
      "updated": 150,
      "inserted": 5,
      "skipped": 2,
      "total": 155
    },
    {
      "sheet": "tech_2",
      "techName": "Thuc",
      "status": "synced",
      "updated": 120,
      "inserted": 3,
      "skipped": 1,
      "total": 123
    }
  ],
  "timestamp": "2026-02-05T23:00:00.000Z"
}
```

## Understanding the Response

- **updated:** Existing serials that were updated
- **inserted:** New serials added from sheets
- **skipped:** Rows missing required data (tracking, serial, or date)
- **total:** Total rows processed successfully

## Verification After Sync

Check the database:
```sql
-- Count by tester
SELECT 
  s.name as tester_name,
  COUNT(*) as serials_scanned
FROM tech_serial_numbers tsn
JOIN staff s ON tsn.tester_id = s.id
GROUP BY s.name
ORDER BY serials_scanned DESC;

-- Check recent syncs
SELECT 
  serial_number,
  shipping_tracking_number,
  test_date_time,
  tester_id
FROM tech_serial_numbers
ORDER BY created_at DESC
LIMIT 10;
```

## Sync Behavior

### If Serial Exists
- **Updates** `test_date_time` from sheet
- **Updates** `tester_id` from sheet
- Keeps existing `serial_type`

### If Serial Doesn't Exist
- **Inserts** new row
- Sets `test_date_time` from sheet
- Sets `tester_id` from sheet name
- Detects `serial_type` (SERIAL or FNSKU)

## Troubleshooting

### Sync Returns "skipped" Rows
**Cause:** Missing required data in Google Sheets

**Check:**
- Column A has date/time
- Column C has tracking number
- Column D has serial number

### Serial Not Found After Sync
**Cause:** Serial may be in a different tech sheet

**Check:**
- Verify which tech sheet has the serial
- Check if serial is uppercased correctly
- Verify tracking number matches

### Date Format Issues
**Supported formats:**
- `M/D/YYYY H:mm:ss` (e.g., "2/5/2026 14:30:00")
- ISO 8601 timestamps

**Invalid dates will be skipped.**

## Current Database State

### Orders Table (No Test Tracking)
```
- Order metadata (id, order_id, product_title, sku, etc.)
- Packing data (packed_by, pack_date_time)
- Assignment data (packer_id)
- Join key (shipping_tracking_number)
```

### Tech Serial Numbers Table (All Test Tracking)
```
- Serial data (serial_number, serial_type)
- Test tracking (tester_id, test_date_time)
- Join key (shipping_tracking_number)
- 1,230 serials (100% have tester_id)
```

## Migration History

1. ✅ Created `tech_serial_numbers` table
2. ✅ Migrated 1,230 serials from `orders.serial_number`
3. ✅ Removed `serial_number`, `test_date_time`, `tested_by` from orders
4. ✅ Removed `tester_id` from orders table
5. ✅ All test tracking now in `tech_serial_numbers`

## Notes

- **Server must be running** to use the sync API
- **Google Sheets credentials** must be configured
- **Sync is safe** - won't create duplicates (uses ON CONFLICT)
- **Can run multiple times** - idempotent operation
- **No data loss** - only updates or inserts, never deletes

## Ready to Use! 🎉

Your database is fully set up with:
- Clean separation of order and test data
- All 1,230 serials have tester_id
- Google Sheets sync API ready
- Scanner app writing directly to database

Run the sync whenever you need to update from Google Sheets!
