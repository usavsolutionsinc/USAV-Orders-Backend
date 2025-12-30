# Migration from JavaScript to Python

All database migration scripts have been converted from JavaScript (Node.js) to Python for easier management and consistency.

## What Changed

### Converted Scripts

| Old JavaScript File | New Python File | Purpose |
|---------------------|-----------------|---------|
| `setup-db.js` | `setup_db.py` | Initial database setup |
| `migrate-gas-logic.js` | `migrate_gas_logic.py` | GAS logic tables |
| `migrate-skus-table.js` | `migrate_skus_table.py` | SKU table |
| `migrate-daily-tasks.js` | `migrate_daily_tasks.py` | Daily tasks system |

### New Utility Scripts

- `run_all_migrations.py` - Master script to run all migrations in order
- `sync_sheets_direct.py` - Google Sheets sync (direct API)
- `sync_sheets_to_db.py` - Google Sheets sync (via Apps Script)

## Benefits

1. **Consistency** - All scripts now use Python
2. **Easier Management** - Single language for all database operations
3. **Better Error Handling** - Python's exception handling
4. **Simpler Dependencies** - One `requirements.txt` for all scripts
5. **Cross-platform** - Python works consistently across platforms

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Run All Migrations

```bash
python3 scripts/run_all_migrations.py
```

Or run individually:

```bash
python3 scripts/setup_db.py
python3 scripts/migrate_gas_logic.py
python3 scripts/migrate_skus_table.py
python3 scripts/migrate_daily_tasks.py
python3 scripts/setup_all_tables.py
```

## Old JavaScript Files

The old `.js` files are kept for reference but are **deprecated**. You can:

1. **Keep them** - For reference or rollback if needed
2. **Delete them** - They're no longer needed
3. **Archive them** - Move to a `deprecated/` folder

To delete old files:

```bash
cd scripts
rm setup-db.js migrate-gas-logic.js migrate-skus-table.js migrate-daily-tasks.js
```

## Environment Setup

All Python scripts use the same `.env.local` file:

```env
DATABASE_URL=postgresql://user:password@host.neon.tech/dbname?sslmode=require
```

No changes needed to your environment variables!

## Testing

Test the migration:

```bash
# Test database connection
python3 -c "import psycopg2; import os; from dotenv import load_dotenv; load_dotenv('.env.local'); conn = psycopg2.connect(os.getenv('DATABASE_URL'), sslmode='require'); print('✓ Connected!'); conn.close()"

# Run a single migration
python3 scripts/setup_db.py

# Run all migrations
python3 scripts/run_all_migrations.py
```

## Next Steps

1. ✅ Test Python scripts work with your database
2. ✅ Update any CI/CD pipelines to use Python scripts
3. ✅ Update documentation references
4. ⚠️ Optional: Delete old JavaScript files
5. ✅ Use `run_all_migrations.py` for fresh database setups

## Support

If you encounter issues:

1. Check Python version: `python3 --version` (should be 3.7+)
2. Install dependencies: `pip install -r requirements.txt`
3. Verify `.env.local` has `DATABASE_URL`
4. Check script output for specific errors

All Python scripts maintain the same functionality as their JavaScript counterparts.
