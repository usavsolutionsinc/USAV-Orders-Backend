#!/usr/bin/env python3
"""
Run all migrations with DATABASE_URL from environment variable or Vercel.
Usage:
  DATABASE_URL="postgresql://..." python3 run_migrations_with_env.py
  Or set it in your shell before running
"""

import os
import subprocess
import sys

# Get DATABASE_URL from environment
DATABASE_URL = os.getenv('DATABASE_URL')

if not DATABASE_URL:
    print("="*60)
    print("ERROR: DATABASE_URL not set!")
    print("="*60)
    print("\nPlease set DATABASE_URL as an environment variable:")
    print("  export DATABASE_URL='postgresql://user:pass@host/db?sslmode=require'")
    print("  python3 scripts/run_migrations_with_env.py")
    print("\nOr pass it directly:")
    print("  DATABASE_URL='postgresql://...' python3 scripts/run_migrations_with_env.py")
    print("\nTo get DATABASE_URL from Vercel:")
    print("  1. Go to Vercel Dashboard > Your Project > Settings > Environment Variables")
    print("  2. Copy the DATABASE_URL value")
    print("  3. Run: DATABASE_URL='your-url' python3 scripts/run_migrations_with_env.py")
    sys.exit(1)

# Set it for all child processes
os.environ['DATABASE_URL'] = DATABASE_URL

# Get the directory where this script is located
script_dir = os.path.dirname(os.path.abspath(__file__))

# List of migration scripts in order
migrations = [
    'setup_db.py',
    'migrate_gas_logic.py',
    'migrate_skus_table.py',
    'migrate_daily_tasks.py',
    'setup_all_tables.py',
]

def run_migration(script_name):
    """Run a single migration script"""
    script_path = os.path.join(script_dir, script_name)
    print(f"\n{'='*60}")
    print(f"Running: {script_name}")
    print('='*60)
    
    try:
        # Pass DATABASE_URL to the subprocess
        env = os.environ.copy()
        env['DATABASE_URL'] = DATABASE_URL
        
        result = subprocess.run(
            [sys.executable, script_path],
            cwd=script_dir,
            env=env,
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
    print(f"Using DATABASE_URL: {DATABASE_URL[:50]}...")
    
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
