# Packer Logs Sync Script

This script syncs data from Google Sheets (`packer_1` and `packer_2` sheets) to the `packer_logs` database table.

## ⚠️ IMPORTANT WARNING

**This script TRUNCATES (deletes ALL) existing packer_logs records before inserting new data.**

The script completely replaces the `packer_logs` table contents with fresh data from Google Sheets.

## Overview

The script reads packer data from two Google Sheets and imports them into the `packer_logs` table with proper tracking type detection and staff assignment.

## Column Mappings

### Google Sheets Columns

Both `packer_1` and `packer_2` sheets use the same column structure:

| Column | Field | Description |
|--------|-------|-------------|
| **A** | `pack_date_time` | Date and time when the item was packed |
| **B** | `shipping_tracking_number` | Tracking number (UPS, USPS, FEDEX, etc.) |
| **C** | Type indicator | Determines the `tracking_type` in database |

### Column C → Tracking Type Logic

The script analyzes **Column C** to determine the `tracking_type`:

| Column C Value | Database `tracking_type` |
|----------------|-------------------------|
| Contains "UPS", "USPS", or "FEDEX" | `ORDERS` |
| Equals "SKU" | `SKU` |
| Equals "FNSKU" | `FNSKU` |
| Empty or unclear | `ORDERS` (default) |

### Sheet → Staff Mapping

| Sheet Name | `packed_by` (Staff ID) | Staff Name |
|------------|----------------------|------------|
| `packer_1` | `4` | Tuan |
| `packer_2` | `5` | Thuy |

## Database Table: packer_logs

The script inserts into the `packer_logs` table:

```sql
CREATE TABLE packer_logs (
  id SERIAL PRIMARY KEY,
  shipping_tracking_number TEXT NOT NULL,
  tracking_type VARCHAR(20) NOT NULL,
  pack_date_time TIMESTAMP,
  packed_by INTEGER REFERENCES staff(id),
  packer_photos_url JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Usage

### Prerequisites

1. Environment variables must be set in `.env`:
   ```env
   DATABASE_URL=your_postgres_connection_string
   GOOGLE_CLIENT_EMAIL=your_service_account_email
   GOOGLE_PRIVATE_KEY=your_service_account_private_key
   ```

2. Google Sheets must exist:
   - Sheet name: `packer_1`
   - Sheet name: `packer_2`
   - Spreadsheet ID: `1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE` (hardcoded in script)

### Running the Script

**Step 1: Preview first (recommended)**
```bash
npm run sync:packer-logs:preview
```
This shows you what data would be synced **without making any database changes**.

**Step 2: Run the actual sync**

**Option 1: Using npm script (recommended)**
```bash
npm run sync:packer-logs
```

**Option 2: Direct execution**
```bash
node sync-packer-sheets-to-logs.js
```

### What the Script Does

1. ✅ Connects to Google Sheets
2. ✅ Starts a database transaction
3. 🗑️ **DELETES ALL existing records from `packer_logs` table**
4. ✅ Reads `packer_1` sheet (columns A, B, C)
5. ✅ Reads `packer_2` sheet (columns A, B, C)
6. ✅ Determines `tracking_type` from Column C
7. ✅ Inserts all records into `packer_logs`
8. ✅ Commits transaction (or rolls back on error)
9. ✅ Prints detailed statistics

## Example Output

```
🚀 Starting packer_logs REPLACE sync from packer_1 and packer_2 sheets...
⚠️  WARNING: This will DELETE ALL existing packer_logs records!

🗑️  Truncating packer_logs table...
   Deleted 450 existing records

📋 Processing packer_1 sheet (packed_by = 4)...
  Found 150 rows in packer_1

  ✅ Inserted 145 records
  ⏭️  Skipped 3 rows (no tracking number)
  ⏭️  Skipped 2 rows (no date/time)

  📊 Records by Tracking Type:
    ORDERS: 120 records
    SKU: 20 records
    FNSKU: 5 records

📋 Processing packer_2 sheet (packed_by = 5)...
  Found 130 rows in packer_2

  ✅ Inserted 128 records
  ⏭️  Skipped 2 rows (no tracking number)

  📊 Records by Tracking Type:
    ORDERS: 110 records
    SKU: 15 records
    FNSKU: 3 records

✅ Transaction committed successfully!

============================================================
📊 SYNC SUMMARY
============================================================

🗑️  Deleted: 450 old records

packer_1 (Tuan - ID: 4):
  ✅ Inserted: 145
  ⏭️  Skipped: 5

packer_2 (Thuy - ID: 5):
  ✅ Inserted: 128
  ⏭️  Skipped: 2

🎉 TOTAL: 273 new records inserted, 7 skipped
============================================================
```

## Features

### 🗑️ Complete Table Replacement
- **Deletes all existing records first** (TRUNCATE)
- Uses database transactions for safety
- Rolls back on error (all-or-nothing)
- Fresh data on every sync

### ✅ Smart Type Detection
- Automatically detects carrier names (UPS, USPS, FEDEX)
- Handles SKU and FNSKU tracking types
- Case-insensitive matching
- Defaults to ORDERS for unclear values

### ✅ Data Validation
- Skips rows with missing tracking numbers
- Skips rows with missing date/time
- Provides detailed skip reasons

### ✅ Progress Tracking
- Shows per-sheet statistics
- Tracks by tracking type
- Summary at the end

## Troubleshooting

### "Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY"
- Check that `.env` file exists
- Verify environment variables are set correctly
- Make sure `GOOGLE_PRIVATE_KEY` has proper line breaks (`\n`)

### "Sheet not found"
- Verify sheet names are exactly `packer_1` and `packer_2` (case-insensitive)
- Check Google Sheets ID matches: `1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE`
- Ensure service account has access to the sheet

### "Connection timeout"
- Check `DATABASE_URL` in `.env`
- Verify database is accessible
- Check network connectivity

### No records inserted / Fewer records than expected
- Verify Google Sheets have data in columns A, B, C (starting from row 2)
- Check for missing tracking numbers (column B) or date/times (column A)
- Look at the "Skipped" count in the output for details

## Related Files

- **Script**: `sync-packer-sheets-to-logs.js`
- **Schema**: `src/lib/drizzle/schema.ts` (packer_logs table)
- **Migration**: `src/lib/migrations/2026-02-06_create_packer_logs_and_migrate_pack_date_time.sql`
- **Similar Script**: `update-tech-serial-testers.js` (for tech_serial_numbers)
- **API Sync**: `src/app/api/sync-sheets/route.ts` (includes packer sheets sync)

## Notes

- This script **REPLACES ALL DATA** - it deletes existing records before inserting new ones
- Uses database transactions for safety (rolls back on error)
- Run this script to sync the latest packer data from Google Sheets
- Google Sheets becomes the single source of truth for packer_logs
- **Always run the preview first** to verify data before syncing
