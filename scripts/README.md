# Database Migration Scripts

All migration scripts have been converted from JavaScript to Python for easier management and consistency.

## Available Scripts

### Core Migrations

1. **`setup_db.py`** - Initial database setup
   - Creates: `orders`, `shipped`, `receiving`
   - Seeds sample data if tables are empty
   - Converted from `setup-db.js`

2. **`migrate_gas_logic.py`** - Google Apps Script logic tables
   - Creates: `sku_stock`, `technician_logs`, `packer_logs`, `receiving_logs`
   - Alters `shipped` table with additional columns
   - Converted from `migrate-gas-logic.js`

3. **`migrate_skus_table.py`** - SKU table
   - Creates: `skus` table with index
   - Converted from `migrate-skus-table.js`

4. **`migrate_daily_tasks.py`** - Daily tasks system
   - Creates: `task_templates`, `daily_task_instances`
   - Seeds default task templates
   - Converted from `migrate-daily-tasks.js`

5. **`setup_all_tables.py`** - Google Sheets sync tables
   - Creates: `tech_0`, `tech_1`, `tech_2`, `Packer_0`, `Packer_1`
   - Ensures all tables needed for Sheets sync exist
   - Includes extended `orders` table columns

### Utility Scripts

6. **`run_all_migrations.py`** - Master migration script
   - Runs all migrations in the correct order
   - Stops on first error
   - Use this for fresh database setup

7. **`sync_sheets_direct.py`** - Google Sheets to DB sync
   - Syncs all sheet data to database
   - Uses Google Sheets API directly

8. **`sync_sheets_to_db.py`** - Alternative sync method
   - Syncs via Google Apps Script Web App
   - Fallback if direct API doesn't work

## Usage

### Run All Migrations (Recommended for Fresh Setup)

```bash
python3 scripts/run_all_migrations.py
```

This will run all migrations in the correct order:
1. `setup_db.py`
2. `migrate_gas_logic.py`
3. `migrate_skus_table.py`
4. `migrate_daily_tasks.py`
5. `setup_all_tables.py`

### Run Individual Migrations

```bash
# Initial setup
python3 scripts/setup_db.py

# GAS logic tables
python3 scripts/migrate_gas_logic.py

# SKU table
python3 scripts/migrate_skus_table.py

# Daily tasks
python3 scripts/migrate_daily_tasks.py

# Sheets sync tables
python3 scripts/setup_all_tables.py
```

### Sync Google Sheets

```bash
# Direct API (recommended)
python3 scripts/sync_sheets_direct.py

# Via Apps Script
python3 scripts/sync_sheets_to_db.py
```

## Environment Variables

All scripts require `.env.local` with:

```env
DATABASE_URL=postgresql://user:password@host.neon.tech/dbname?sslmode=require
```

For sync scripts, also add:
```env
GOOGLE_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYourKey\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=your_google_sheet_id
APPS_SCRIPT_WEBAPP_URL=https://script.google.com/macros/s/YOUR_ID/exec
```

## Migration Order

When setting up a fresh database, run migrations in this order:

1. `setup_db.py` - Base tables
2. `migrate_gas_logic.py` - Logs and stock tables
3. `migrate_skus_table.py` - SKU table
4. `migrate_daily_tasks.py` - Task system
5. `setup_all_tables.py` - Worker-specific tables

Or simply use: `run_all_migrations.py`

## Notes

- All scripts are idempotent (safe to run multiple times)
- Scripts use `CREATE TABLE IF NOT EXISTS` to avoid errors
- Old JavaScript files (`.js`) are deprecated but kept for reference
- Python scripts follow the same logic as their JS counterparts

## Troubleshooting

### "Module not found" errors
```bash
pip install -r requirements.txt
```

### Database connection errors
- Verify `DATABASE_URL` in `.env.local`
- Check Neon database is accessible
- Ensure SSL is enabled

### Migration conflicts
- Scripts use `IF NOT EXISTS` clauses
- Safe to re-run if interrupted
- Check logs for specific errors

## Deprecated Files

The following JavaScript files are deprecated but kept for reference:
- `setup-db.js` → Use `setup_db.py`
- `migrate-gas-logic.js` → Use `migrate_gas_logic.py`
- `migrate-skus-table.js` → Use `migrate_skus_table.py`
- `migrate-daily-tasks.js` → Use `migrate_daily_tasks.py`
