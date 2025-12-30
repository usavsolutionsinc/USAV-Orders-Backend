#!/usr/bin/env python3
"""
Run all database migrations in the correct order.
This is a master script that runs all migration scripts sequentially.
"""

import subprocess
import sys
import os

# Get the directory where this script is located
script_dir = os.path.dirname(os.path.abspath(__file__))

# List of migration scripts in order
migrations = [
    'setup_db.py',              # Initial tables: orders, shipped, receiving
    'migrate_gas_logic.py',     # Logs and sku_stock, alter shipped
    'migrate_skus_table.py',    # SKU table
    'migrate_daily_tasks.py',  # Daily tasks tables
    'setup_all_tables.py',     # Worker-specific tables (tech_0-2, Packer_0-1)
]

def run_migration(script_name):
    """Run a single migration script"""
    script_path = os.path.join(script_dir, script_name)
    print(f"\n{'='*60}")
    print(f"Running: {script_name}")
    print('='*60)
    
    try:
        result = subprocess.run(
            [sys.executable, script_path],
            cwd=script_dir,
            check=True,
            capture_output=False
        )
        print(f"✓ {script_name} completed successfully")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ {script_name} failed with exit code {e.returncode}")
        return False
    except Exception as e:
        print(f"❌ Error running {script_name}: {e}")
        return False

def main():
    print("="*60)
    print("Running All Database Migrations")
    print("="*60)
    
    failed = []
    
    for migration in migrations:
        if not run_migration(migration):
            failed.append(migration)
    
    print("\n" + "="*60)
    if failed:
        print(f"❌ Migration completed with {len(failed)} failure(s):")
        for script in failed:
            print(f"  - {script}")
        sys.exit(1)
    else:
        print("✅ All migrations completed successfully!")
        sys.exit(0)

if __name__ == "__main__":
    main()
