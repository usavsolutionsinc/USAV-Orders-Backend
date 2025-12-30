# Google Sheets to Neon DB Sync - Complete Setup Guide

## Overview

This system syncs data from Google Sheets to your Neon Postgres database, making all data available to your Next.js website. All workers can now see real-time data from the database instead of relying on Google Sheets.

## What Was Created

### 1. Python Scripts

#### `scripts/setup_all_tables.py`
- Creates all required database tables
- Handles: orders, tech_0-2, Packer_0-1, receiving, shipped, sku_stock, sku
- Run once to set up your database schema

#### `scripts/sync_sheets_to_db.py`
- Syncs data via Google Apps Script Web App
- Uses `APPS_SCRIPT_WEBAPP_URL` to fetch data
- Handles all sheet instances

#### `scripts/sync_sheets_direct.py`
- Alternative sync using Google Sheets API directly
- Uses `gspread` library for direct access
- No Apps Script required

### 2. API Endpoint

#### `/api/sync-sheets` (POST)
- Triggers sync from Next.js
- Can be called manually or scheduled
- Returns sync status and results

### 3. Google Apps Script Functions

Added to `Working` file:
- `syncAllSheetsToBackend()` - Manual sync trigger
- `setupBackendSyncTrigger()` - Set up hourly automatic sync
- `removeBackendSyncTrigger()` - Remove automatic sync

## Quick Start

### Step 1: Install Python Dependencies

```bash
cd USAV-Orders-Backend
pip install -r requirements.txt
```

### Step 2: Set Up Environment Variables

Add to `.env.local`:

```env
DATABASE_URL=postgresql://user:password@host.neon.tech/dbname?sslmode=require
GOOGLE_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYourKeyHere\n-----END PRIVATE KEY-----\n"
APPS_SCRIPT_WEBAPP_URL=https://script.google.com/macros/s/YOUR_WEBAPP_ID/exec
GOOGLE_SHEET_ID=your_google_sheet_id
```

### Step 3: Create Database Tables

```bash
python3 scripts/setup_all_tables.py
```

### Step 4: Test Sync

```bash
# Option 1: Direct API (recommended)
python3 scripts/sync_sheets_direct.py

# Option 2: Via Apps Script
python3 scripts/sync_sheets_to_db.py
```

### Step 5: Trigger Sync via API

```bash
curl -X POST http://localhost:3000/api/sync-sheets
```

Or from your browser/Postman, POST to `/api/sync-sheets`

## Sheet to Table Mapping

| Google Sheet | Database Table | Description |
|--------------|----------------|-------------|
| `orders` | `orders` | Main orders |
| `tech_0` | `tech_0` | Technician 0 data |
| `tech_1` | `tech_1` | Technician 1 data |
| `tech_2` | `tech_2` | Technician 2 data |
| `Packer_0` | `Packer_0` | Packer 0 data |
| `Packer_1` | `Packer_1` | Packer 1 data |
| `receiving` | `receiving` | Receiving items |
| `shipped` | `shipped` | Shipped orders |
| `sku-stock` | `sku_stock` | SKU inventory |
| `sku` | `skus` | SKU information |

## Automatic Sync Options

### Option 1: Google Apps Script Trigger (Recommended)

1. Open your Google Sheet
2. Go to Extensions → Apps Script
3. Find `setupBackendSyncTrigger()` function
4. Run it to set up hourly sync

### Option 2: Cron Job (Server)

```bash
# Edit crontab
crontab -e

# Add this line (runs every hour)
0 * * * * cd /path/to/USAV-Orders-Backend && python3 scripts/sync_sheets_direct.py >> /tmp/sync.log 2>&1
```

### Option 3: Vercel Cron

Add to `vercel.json`:

```json
{
  "crons": [{
    "path": "/api/sync-sheets",
    "schedule": "0 * * * *"
  }]
}
```

## How It Works

1. **Data Source**: Google Sheets (with service account access)
2. **Sync Script**: Python script reads from Sheets
3. **Database**: Writes to Neon Postgres with conflict handling
4. **API**: Next.js API serves data to frontend
5. **Frontend**: Workers see real-time data from database

## Data Flow

```
Google Sheets
    ↓
Python Sync Script (sync_sheets_direct.py or sync_sheets_to_db.py)
    ↓
Neon Postgres Database
    ↓
Next.js API Routes (/api/orders, /api/receiving, etc.)
    ↓
React Frontend (Packer/Technician pages)
```

## Troubleshooting

### "Module not found" errors
```bash
pip install -r requirements.txt
```

### Database connection errors
- Verify `DATABASE_URL` is correct
- Check Neon database is accessible
- Ensure SSL is enabled

### Google Sheets access errors
- Verify service account email has access to the sheet
- Check `GOOGLE_PRIVATE_KEY` format (needs `\n` for newlines)
- Ensure sheet is shared with service account email

### Empty sync results
- Check sheet names match exactly (case-sensitive)
- Verify sheets have data (not just headers)
- Check Python script output for errors

## Testing

### Test Database Connection
```python
import psycopg2
import os
from dotenv import load_dotenv

load_dotenv('.env.local')
conn = psycopg2.connect(os.getenv('DATABASE_URL'), sslmode='require')
print("✓ Database connection successful!")
conn.close()
```

### Test Google Sheets Access
```python
import gspread
from google.oauth2.service_account import Credentials
import os
from dotenv import load_dotenv

load_dotenv('.env.local')
# Use same code from sync_sheets_direct.py
client = get_google_sheets_client()
spreadsheet = client.open_by_key(os.getenv('GOOGLE_SHEET_ID'))
print(f"✓ Access to sheet: {spreadsheet.title}")
```

## Next Steps

1. ✅ Run `setup_all_tables.py` to create tables
2. ✅ Test sync with `sync_sheets_direct.py`
3. ✅ Set up automatic sync (choose one method above)
4. ✅ Verify data appears in your Next.js app
5. ✅ Train workers to use the website instead of Sheets

## Notes

- Sync uses `ON CONFLICT` to handle duplicates (updates existing records)
- Dates are automatically parsed from various formats
- Empty cells become `NULL` in database
- All syncs are logged for debugging
- The system is designed to be idempotent (safe to run multiple times)

## Support

For issues:
1. Check Python script output for errors
2. Verify environment variables are set
3. Test database connection separately
4. Test Google Sheets access separately
5. Check Next.js API logs
