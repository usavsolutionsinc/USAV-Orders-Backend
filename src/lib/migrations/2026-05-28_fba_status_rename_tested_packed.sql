-- ============================================================================
-- 2026-05-28: FBA status vocabulary — READY_TO_GO→TESTED, PACKING→PACKED
-- ============================================================================
-- Aligns fba_shipment_status_enum with the operator-facing lifecycle:
--
--   PLANNED → TESTED → PACKED → LABEL_ASSIGNED (combined) → SHIPPED
--
--   PLANNED        — planning/inventory + staff acknowledge today's FBA items
--   TESTED         — technician scanned the FNSKU; passed, ready to be packed
--   PACKED         — packer scanned the FNSKU; ready to combine
--   LABEL_ASSIGNED — combined under one FBA shipment ID (multi-UPS tracking)
--   SHIPPED        — UPS tracking scanned; whole package handed to carrier
--
-- RENAME VALUE is in-place: existing rows keep their data under the new name,
-- and dependent indexes/defaults/constraints follow automatically. Postgres
-- cannot DROP enum values, so the old names simply cease to exist after this
-- runs — every code reference must flip in the same deploy.
--
-- NOTE: this touches ONLY fba_shipment_status_enum. The identically-named
-- 'PACKING' value on serial_status_enum (inventory v2) is a different type
-- and is intentionally left untouched.
--
-- Idempotent: guarded so a replay after the rename is a no-op.
-- ============================================================================

BEGIN;

-- ─── READY_TO_GO → TESTED ──────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'fba_shipment_status_enum' AND e.enumlabel = 'READY_TO_GO'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'fba_shipment_status_enum' AND e.enumlabel = 'TESTED'
  ) THEN
    ALTER TYPE fba_shipment_status_enum RENAME VALUE 'READY_TO_GO' TO 'TESTED';
  END IF;
END $$;

-- ─── PACKING → PACKED ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'fba_shipment_status_enum' AND e.enumlabel = 'PACKING'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'fba_shipment_status_enum' AND e.enumlabel = 'PACKED'
  ) THEN
    ALTER TYPE fba_shipment_status_enum RENAME VALUE 'PACKING' TO 'PACKED';
  END IF;
END $$;

COMMIT;
