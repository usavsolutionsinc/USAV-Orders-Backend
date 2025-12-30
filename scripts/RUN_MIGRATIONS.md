# Running All Migrations

## Status

✅ **Old JavaScript scripts deleted:**
- `setup-db.js` ❌
- `migrate-gas-logic.js` ❌
- `migrate-skus-table.js` ❌
- `migrate-daily-tasks.js` ❌

✅ **Python scripts ready:**
- `setup_db.py`
- `migrate_gas_logic.py`
- `migrate_skus_table.py`
- `migrate_daily_tasks.py`
- `setup_all_tables.py`
- `run_all_migrations.py` (master script)

## Quick Start

### Step 1: Install Python Dependencies

```bash
cd USAV-Orders-Backend
pip3 install -r requirements.txt
```

Or install individually:
```bash
pip3 install psycopg2-binary python-dotenv
```

**Note:** If you get permission errors, try:
```bash
pip3 install --user psycopg2-binary python-dotenv
```

Or use a virtual environment:
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Step 2: Verify Environment Variables

Make sure `.env.local` exists with:
```env
DATABASE_URL=postgresql://user:password@host.neon.tech/dbname?sslmode=require
```

### Step 3: Run All Migrations

```bash
python3 scripts/run_all_migrations.py
```

This will run all migrations in order:
1. ✅ `setup_db.py` - Base tables (orders, shipped, receiving)
2. ✅ `migrate_gas_logic.py` - Logs and stock tables
3. ✅ `migrate_skus_table.py` - SKU table
4. ✅ `migrate_daily_tasks.py` - Daily tasks system
5. ✅ `setup_all_tables.py` - Worker tables (tech_0-2, Packer_0-1)

## Expected Output

```
============================================================
Running All Database Migrations
============================================================

============================================================
Running: setup_db.py
============================================================
Creating tables...
✓ Orders table created/verified.
✓ Shipped table created/verified.
✓ Receiving table created/verified.
✓ Sample orders seeded.

✅ Database setup completed successfully!
✓ setup_db.py completed successfully

[... similar output for each migration ...]

✅ All migrations completed successfully!
```

## Troubleshooting

### "Module not found: psycopg2"
Install dependencies: `pip3 install psycopg2-binary python-dotenv`

### "DATABASE_URL not set"
Check `.env.local` file exists and has `DATABASE_URL`

### Permission errors
Use `--user` flag or virtual environment (see Step 1)

### Connection errors
- Verify `DATABASE_URL` is correct
- Check Neon database is accessible
- Ensure SSL is enabled in connection string

## Manual Run (Alternative)

If you prefer to run migrations individually:

```bash
python3 scripts/setup_db.py
python3 scripts/migrate_gas_logic.py
python3 scripts/migrate_skus_table.py
python3 scripts/migrate_daily_tasks.py
python3 scripts/setup_all_tables.py
```

## Next Steps

After migrations complete:
1. ✅ Verify tables exist in your Neon database
2. ✅ Test your Next.js app connects to database
3. ✅ Run Google Sheets sync: `python3 scripts/sync_sheets_direct.py`
