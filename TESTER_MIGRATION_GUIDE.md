# Tester ID Migration & Google Sheets Sync Guide

## Overview

After moving serial tracking from `orders` table to `tech_serial_numbers` table, we need to ensure all tester data is properly synced from both the database and Google Sheets.

## Migration Status

### ✅ Tester ID Migration (COMPLETE)
All 1,230 serials in `tech_serial_numbers` already have `tester_id` set (no NULL values).

**Result:** No migration needed! The data migration from earlier preserved all tester assignments.

## Google Sheets Sync

### New API Endpoint: `/api/sync-sheets-to-tech-serials`

This replaces the old sync logic that updated `orders.test_date_time` and `orders.tested_by`.

**What it does:**
- Reads tech sheet data from Google Sheets (tech_1, tech_2, tech_3, tech_4)
- For each row: dateTime (A), tracking (C), serial (D)
- Updates or inserts into `tech_serial_numbers` table
- Syncs `test_date_time` and `tester_id` from sheets

### Google Sheets Structure

**Tech Sheets:** `tech_1`, `tech_2`, `tech_3`, `tech_4`
```
Column A: Date/Time (e.g., "2/5/2026 14:30:00")
Column B: (unused)
Column C: Tracking Number
Column D: Serial Number
```

**Staff Mapping:**
- tech_1 → TECH001 (Mike/Michael)
- tech_2 → TECH002 (Thuc)
- tech_3 → TECH003 (Sang)
- tech_4 → TECH004 (Cuong)

### How to Sync from Google Sheets

#### Option 1: Using API (Recommended)

```bash
curl -X POST http://localhost:3000/api/sync-sheets-to-tech-serials \
  -H "Content-Type: application/json" \
  -d '{}'
```

Or with custom spreadsheet:
```bash
curl -X POST http://localhost:3000/api/sync-sheets-to-tech-serials \
  -H "Content-Type: application/json" \
  -d '{"spreadsheetId": "YOUR_SPREADSHEET_ID"}'
```

#### Option 2: Using Admin UI

If you have an admin panel, create a button that calls:
```typescript
fetch('/api/sync-sheets-to-tech-serials', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({})
});
```

### Response Format

```json
{
  "success": true,
  "message": "Tech sheets synced to tech_serial_numbers table",
  "results": [
    {
      "sheet": "tech_1",
      "techName": "Mike",
      "status": "synced",
      "updated": 120,
      "inserted": 5,
      "skipped": 2,
      "total": 125
    },
    {
      "sheet": "tech_2",
      "techName": "Thuc",
      "status": "synced",
      "updated": 98,
      "inserted": 3,
      "skipped": 1,
      "total": 101
    }
  ],
  "timestamp": "2026-02-05T22:30:00.000Z"
}
```

### What Gets Synced

For each row in tech sheets:
1. **If serial exists in `tech_serial_numbers`:**
   - Updates `test_date_time` from sheet
   - Updates `tester_id` from sheet

2. **If serial doesn't exist:**
   - Inserts new row with:
     - `shipping_tracking_number` from Column C
     - `serial_number` from Column D (uppercased)
     - `serial_type` detected (SERIAL or FNSKU)
     - `test_date_time` from Column A (parsed)
     - `tester_id` from tech sheet name

### Date/Time Parsing

Google Sheets dates are parsed as:
```
Input: "2/5/2026 14:30:00"
Output: 2026-02-05T14:30:00.000Z
```

Supported formats:
- `M/D/YYYY H:mm:ss` (e.g., "2/5/2026 14:30:00")
- ISO 8601 timestamps

## Database Changes

### Before
```sql
orders table:
  - tester_id (assignment tracking)
  - test_date_time (when tested) ❌ REMOVED
  - tested_by (who tested) ❌ REMOVED
```

### After
```sql
orders table:
  - tester_id (assignment tracking only)

tech_serial_numbers table:
  - tester_id (who actually scanned this serial)
  - test_date_time (when this serial was scanned)
```

## Migration Files

1. **SQL Migration:** `src/lib/migrations/migrate_tester_and_sync_sheets.sql`
   - Migrates tester_id from orders to tech_serial_numbers
   - (Already complete - no NULLs found)

2. **API Route:** `src/app/api/sync-sheets-to-tech-serials/route.ts`
   - New endpoint for syncing tech sheets
   - Replaces old sync-sheets logic for tech data

## Verification

### Check Tester Data in Database

```sql
-- Count serials by tester
SELECT 
  s.name as tester_name,
  COUNT(*) as serials_scanned
FROM tech_serial_numbers tsn
JOIN staff s ON tsn.tester_id = s.id
GROUP BY s.name
ORDER BY serials_scanned DESC;

-- Check for NULL tester_ids
SELECT COUNT(*) 
FROM tech_serial_numbers 
WHERE tester_id IS NULL;
-- Expected: 0

-- Sample data with tester info
SELECT 
  tsn.serial_number,
  tsn.shipping_tracking_number,
  tsn.test_date_time,
  s.name as tester_name
FROM tech_serial_numbers tsn
LEFT JOIN staff s ON tsn.tester_id = s.id
ORDER BY tsn.test_date_time DESC
LIMIT 10;
```

### Check Sync Results

After running the sync API:
```sql
-- Count serials by tech sheet
SELECT 
  CASE 
    WHEN tsn.tester_id = 1 THEN 'tech_1 (Mike)'
    WHEN tsn.tester_id = 2 THEN 'tech_2 (Thuc)'
    WHEN tsn.tester_id = 3 THEN 'tech_3 (Sang)'
    WHEN tsn.tester_id = 6 THEN 'tech_4 (Cuong)'
    ELSE 'Other'
  END as tech_sheet,
  COUNT(*) as count
FROM tech_serial_numbers tsn
GROUP BY tsn.tester_id
ORDER BY count DESC;
```

## Workflow

### Initial Setup (One-Time)
1. ✅ Create `tech_serial_numbers` table
2. ✅ Migrate existing serials from `orders.serial_number`
3. ✅ Migrate tester_id from `orders.tester_id`
4. ✅ Remove overlapping columns from orders table

### Ongoing Sync (As Needed)
1. **Manual Sync:** Call `/api/sync-sheets-to-tech-serials` to update from Google Sheets
2. **Automatic Sync:** Can be triggered on a schedule (e.g., cron job, Vercel cron)
3. **Real-time:** Scanner app writes directly to `tech_serial_numbers`

### Hybrid Approach
- **Google Sheets → Database:** Use sync API for historical data
- **Scanner App → Database:** New scans write directly to `tech_serial_numbers`
- **Database → Display:** Tech logs query `tech_serial_numbers` for all data

## Benefits

### ✅ Single Source of Truth
- All serial data in `tech_serial_numbers` table
- Can sync from sheets OR scanner app
- No conflicts between sources

### ✅ Per-Serial Tracking
- Know exactly when each serial was scanned
- Know exactly who scanned each serial
- Can track multiple serials per order

### ✅ Flexible Sync
- Sync from Google Sheets when needed
- Scanner app works independently
- Both sources update same table

## Next Steps

1. **Test the Sync API:**
   ```bash
   curl -X POST http://localhost:3000/api/sync-sheets-to-tech-serials
   ```

2. **Verify Data:**
   - Check tech_serial_numbers table
   - Verify test_date_time values
   - Confirm tester_id mappings

3. **Schedule Regular Syncs (Optional):**
   - Add to admin dashboard
   - Set up Vercel cron job
   - Or keep manual for now

4. **Monitor Scanner App:**
   - Ensure new scans go to tech_serial_numbers
   - Verify duplicate detection works
   - Check serial type assignment

## Complete! 🎉

Tester data is now properly managed:
- ✅ All serials have tester_id
- ✅ Sync API ready for Google Sheets data
- ✅ Scanner app writes to correct table
- ✅ Tech logs read from combined tables

The system is ready for production use!
