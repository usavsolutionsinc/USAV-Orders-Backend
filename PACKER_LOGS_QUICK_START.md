# Packer Logs Sync - Quick Start Guide

## ⚠️ IMPORTANT WARNING

**This script DELETES ALL existing packer_logs records before inserting new data!**

Always run the preview first to verify your data.

## 🚀 Quick Start (3 Steps)

### Step 1: Preview the Data (Dry Run) - REQUIRED
```bash
npm run sync:packer-logs:preview
```
This shows what would be synced **without changing the database**.

### Step 2: Run the Sync
```bash
npm run sync:packer-logs
```
This **DELETES ALL existing records** and replaces them with fresh data from Google Sheets.

### Step 3: Verify
Check your database to confirm the data was replaced correctly.

---

## 📊 What Gets Synced

The script copies data from Google Sheets to your database:

### From Google Sheets
- **Sheet**: `packer_1` → **Staff**: Tuan (ID: 4)
- **Sheet**: `packer_2` → **Staff**: Thuy (ID: 5)

### Column Mappings
| Google Sheet Column | Database Field | Example |
|---------------------|----------------|---------|
| A | `pack_date_time` | `02/09/2026, 10:30:45` |
| B | `shipping_tracking_number` | `1Z999AA10123456784` |
| C (type indicator) | `tracking_type` | `UPS` → `ORDERS` |

### Tracking Type Detection
- **Column C** contains "UPS", "USPS", or "FEDEX" → `tracking_type = "ORDERS"`
- **Column C** = "SKU" → `tracking_type = "SKU"`
- **Column C** = "FNSKU" → `tracking_type = "FNSKU"`
- **Column C** is empty → `tracking_type = "ORDERS"` (default)

---

## ✅ Safety Features

- **⚠️ TRUNCATE Mode**: Deletes all existing records first, then inserts fresh data
- **Transaction Safety**: Uses database transactions (rolls back on error)
- **Validation**: Skips rows with missing tracking numbers or dates
- **Dry Run**: Preview before making changes
- **All-or-Nothing**: Either all data syncs successfully or nothing changes

---

## 📁 Files Created

| File | Purpose |
|------|---------|
| `sync-packer-sheets-to-logs.js` | Main sync script |
| `sync-packer-sheets-to-logs-dry-run.js` | Preview/test script |
| `PACKER_LOGS_SYNC.md` | Full documentation |
| `PACKER_LOGS_QUICK_START.md` | This quick reference |

---

## 🔧 NPM Scripts

```bash
# Preview what would be synced (no database changes)
npm run sync:packer-logs:preview

# Actually sync the data
npm run sync:packer-logs
```

---

## 💡 Common Use Cases

### First Time Setup
```bash
# 1. Preview to verify data looks correct
npm run sync:packer-logs:preview

# 2. Run the sync
npm run sync:packer-logs
```

### Regular Updates
```bash
# Preview first to verify data
npm run sync:packer-logs:preview

# Then run the sync (replaces all data)
npm run sync:packer-logs
```

### Troubleshooting
```bash
# Preview to see what's happening
npm run sync:packer-logs:preview
```

---

## 📝 Example Output

### Dry Run
```
🔍 DRY RUN - Preview packer_logs sync (no database changes)

📋 Previewing packer_1 sheet (packed_by = 4)...
  Found 150 rows in packer_1

  📄 Sample Records (first 5):

    1. 1Z999AA10123456784
       Date/Time: 02/09/2026, 10:30:45
       Column C: UPS Ground
       → Would insert as: tracking_type="ORDERS", packed_by=4

  ✅ Would insert 145 records
  ⏭️  Would skip 5 rows

📊 DRY RUN SUMMARY
packer_1 (Tuan - ID: 4):
  ✅ Would insert: 145
  ⏭️  Would skip: 5

🔍 TOTAL: 145 records would be inserted, 5 would be skipped

💡 Note: This was a dry run. No database changes were made.
```

### Actual Sync
```
🚀 Starting packer_logs REPLACE sync from packer_1 and packer_2 sheets...
⚠️  WARNING: This will DELETE ALL existing packer_logs records!

🗑️  Truncating packer_logs table...
   Deleted 450 existing records

📋 Processing packer_1 sheet (packed_by = 4)...
  ✅ Inserted 145 records
  📊 Records by Tracking Type:
    ORDERS: 120 records
    SKU: 20 records
    FNSKU: 5 records

✅ Transaction committed successfully!

🎉 TOTAL: 273 new records inserted, 7 skipped
```

---

## ❓ Need More Help?

- **Full Documentation**: See `PACKER_LOGS_SYNC.md`
- **Troubleshooting**: Check the "Troubleshooting" section in `PACKER_LOGS_SYNC.md`
- **Database Schema**: See `src/lib/drizzle/schema.ts`

---

## 🎯 Quick Troubleshooting

### "No data found"
→ Check that sheets are named exactly `packer_1` and `packer_2`

### "Permission denied"
→ Verify `.env` has correct Google credentials

### "Database error"
→ Check `DATABASE_URL` in `.env`

### Script runs but fewer records than expected
→ Check for missing tracking numbers or dates in Google Sheets
→ Look at the "Skipped" count in the output
