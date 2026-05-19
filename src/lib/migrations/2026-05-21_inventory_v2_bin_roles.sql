-- ============================================================================
-- 2026-05-21: Inventory v2 — Bin Roles + Cycle-Count Locking (Phase A3)
-- ============================================================================
-- Unlocks the WMS-maturity workflows that need a typed bin classification:
--   • Replenishment (PICK_FACE vs RESERVE tiering)
--   • Dock staging  (STAGING / DOCK bins exclude from picking)
--   • Quarantine    (QUARANTINE / DAMAGED bins lock contents out of fulfillment)
--   • Cycle counts  (locked_for_count flag makes a location temporarily unpickable)
--
-- New enum:
--   bin_role_enum — PICK_FACE | RESERVE | STAGING | DOCK | QUARANTINE | DAMAGED | RETURNS | RECEIVING
--
-- New columns on `locations`:
--   bin_role          NOT NULL DEFAULT 'RESERVE' — every existing bin starts as RESERVE; classify post-deploy.
--   locked_for_count  NOT NULL DEFAULT false      — flipped by cycle count campaigns.
--
-- What this migration does NOT do:
--   - Backfill bin_role from the free-text `binType` column. scripts/classify-existing-bins.ts
--     is the companion script that infers roles from existing labels.
--   - Touch the pickability predicate in src/lib/inventory/pickability.ts. That module
--     ships in the same PR and reads these columns directly.
-- ============================================================================

BEGIN;

-- ─── 1. bin_role_enum ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE bin_role_enum AS ENUM (
    'PICK_FACE',
    'RESERVE',
    'STAGING',
    'DOCK',
    'QUARANTINE',
    'DAMAGED',
    'RETURNS',
    'RECEIVING'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TYPE bin_role_enum IS
  'Classification of a bin/location. Drives pickability, replenishment tasks, and cycle-count behavior.';

-- ─── 2. locations.bin_role ────────────────────────────────────────────────
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS bin_role bin_role_enum NOT NULL DEFAULT 'RESERVE';

COMMENT ON COLUMN locations.bin_role IS
  'Role of this bin in the warehouse workflow. PICK_FACE = primary forward-pick face. RESERVE = bulk/backup. STAGING/DOCK = outbound staging. QUARANTINE/DAMAGED = blocked from picking. RETURNS = customer returns receiving. RECEIVING = inbound putaway-pending.';

-- Partial index for the most common query: "all pickable bins by role".
CREATE INDEX IF NOT EXISTS idx_locations_role_active
  ON locations (bin_role)
  WHERE is_active = true;

-- ─── 3. locations.locked_for_count ───────────────────────────────────────
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS locked_for_count BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN locations.locked_for_count IS
  'When true, no pick may pull from this bin. Flipped by active cycle-count campaigns to prevent race conditions during inventory audits.';

-- Partial index — supervisor query "which bins are currently locked?".
CREATE INDEX IF NOT EXISTS idx_locations_locked_for_count
  ON locations (locked_for_count)
  WHERE locked_for_count = true;

COMMIT;
