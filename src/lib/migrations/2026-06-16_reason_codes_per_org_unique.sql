-- ============================================================================
-- 2026-06-16_reason_codes_per_org_unique.sql
--
-- Tenant-isolation slice (reason_codes), step 1 of 2 — correctness.
--
-- reason_codes was created with `code TEXT UNIQUE NOT NULL` — a GLOBAL unique
-- constraint. Once a second tenant onboards, two orgs legitimately need the
-- same code (e.g. both have 'DAMAGE'); the global unique would reject the
-- second org's insert. The natural key for a tenant-scoped table is
-- (organization_id, code), not (code).
--
-- This migration is pure correctness and is SAFE TO APPLY NOW (it does not
-- enable FORCE / RLS enforcement — that is step 2, the gated .sql.template).
-- It is idempotent.
--
-- Note: today USAV is the only tenant, so every existing code is already
-- unique within its org — the composite unique cannot collide on backfill.
-- ============================================================================

DO $$
BEGIN
  -- Drop the implicit global unique (Postgres names it <table>_<col>_key for a
  -- column-level UNIQUE in CREATE TABLE). Guarded so re-runs are no-ops.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'reason_codes'::regclass
      AND conname = 'reason_codes_code_key'
  ) THEN
    ALTER TABLE reason_codes DROP CONSTRAINT reason_codes_code_key;
    RAISE NOTICE 'dropped global unique reason_codes_code_key';
  END IF;

  -- Add the tenant-scoped natural key. The POST /api/reason-codes 409-on-dup
  -- path keys on the 23505 unique violation, which still fires for a duplicate
  -- code WITHIN the same org.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'reason_codes'::regclass
      AND conname = 'reason_codes_org_code_key'
  ) THEN
    ALTER TABLE reason_codes
      ADD CONSTRAINT reason_codes_org_code_key UNIQUE (organization_id, code);
    RAISE NOTICE 'added per-org unique reason_codes_org_code_key (organization_id, code)';
  END IF;
END $$;
