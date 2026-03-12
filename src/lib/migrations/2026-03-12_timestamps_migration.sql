-- ============================================================
-- Migration: 2026-03-12 - Proper created_at / updated_at schema
--
-- tech_serial_numbers: test_date_time → split into
--   created_at (immutable insert time, already exists)
--   updated_at (new column, updated when serials are appended)
--
-- packer_logs: pack_date_time → split into
--   created_at (immutable scan time, already exists)
--   updated_at (new column)
--
-- receiving: drop legacy date_time column (receiving_date_time,
--   created_at, updated_at already exist)
-- ============================================================

BEGIN;

-- ─── tech_serial_numbers ─────────────────────────────────────

-- 1. Add updated_at (nullable first so it can be backfilled)
ALTER TABLE tech_serial_numbers
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- 2. Backfill created_at from test_date_time for legacy rows that
--    were inserted before created_at was added (or where it's null).
UPDATE tech_serial_numbers
  SET created_at = test_date_time
  WHERE created_at IS NULL
    AND test_date_time IS NOT NULL;

-- 3. Backfill updated_at = test_date_time for all rows
UPDATE tech_serial_numbers
  SET updated_at = COALESCE(test_date_time, created_at, NOW())
  WHERE updated_at IS NULL;

-- 4. Set defaults so future rows are stamped automatically
ALTER TABLE tech_serial_numbers
  ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE tech_serial_numbers
  ALTER COLUMN created_at SET DEFAULT NOW();

-- 5. Drop the old combined timestamp column
ALTER TABLE tech_serial_numbers
  DROP COLUMN IF EXISTS test_date_time;

-- ─── packer_logs ─────────────────────────────────────────────

-- 1. Add updated_at
ALTER TABLE packer_logs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- 2. Backfill created_at from pack_date_time where diverged
--    (created_at defaults to NOW() at insert, pack_date_time was
--    passed explicitly from the client; align them).
UPDATE packer_logs
  SET created_at = pack_date_time
  WHERE pack_date_time IS NOT NULL
    AND (
      created_at IS NULL
      OR ABS(EXTRACT(EPOCH FROM (created_at - pack_date_time))) > 5
    );

-- 3. Backfill updated_at
UPDATE packer_logs
  SET updated_at = COALESCE(pack_date_time, created_at, NOW())
  WHERE updated_at IS NULL;

-- 4. Set defaults
ALTER TABLE packer_logs
  ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE packer_logs
  ALTER COLUMN created_at SET DEFAULT NOW();

-- 5. Drop the old combined timestamp column
ALTER TABLE packer_logs
  DROP COLUMN IF EXISTS pack_date_time;

-- ─── receiving ───────────────────────────────────────────────

-- Drop legacy date_time column (receiving_date_time, created_at,
-- and updated_at already exist and are properly populated).
ALTER TABLE receiving
  DROP COLUMN IF EXISTS date_time;

COMMIT;
