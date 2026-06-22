-- ============================================================================
-- 2026-06-19_serial_units_org_scoped_unique.sql
--
-- Multi-tenant hardening: re-scope the serial_units natural key from a GLOBAL
-- unique on (normalized_serial) to a PER-ORG unique on
-- (organization_id, normalized_serial).
--
-- WHY (long-term SaaS correctness):
--   * A serial string is only unique WITHIN a tenant's inventory. Two different
--     resellers can legitimately receive units that carry the same serial.
--   * Under FORCE RLS a globally-unique string key is a tenant LEAK: a second
--     org inserting a serial the first org already has gets a duplicate-key
--     error — revealing the other tenant's data AND blocking a legitimate
--     receive it can't even see.
--   * The canonical writer (src/lib/neon/serial-units-queries.ts upsertSerialUnit)
--     already locks per-org via `SELECT ... FOR UPDATE WHERE organization_id = $`
--     and stamps org on INSERT, with the comment "normalized_serial is a string
--     key that collides across tenants." This migration makes the DB constraint
--     finally match that long-standing intent.
--
-- SAFE ON EXISTING DATA:
--   * serial_units.organization_id is already NOT NULL (2026-05-23 business-table
--     sweep), so the composite index has no NULL component.
--   * The OLD global unique forbids ANY duplicate normalized_serial, so no two
--     existing rows can share one — the new composite index therefore cannot
--     hit a uniqueness violation when it is built.
--
-- DEPENDENT CODE updated in the same change set (the two raw ON CONFLICT
-- fallbacks that named the old single-column target):
--   * src/app/api/receiving/mark-received/route.ts  (applyInventoryV2Effects)
--   * src/lib/tech/insertTechSerialForTracking.ts    (linkTechSerialToInventoryV2)
--   Both now stamp organization_id explicitly and target
--   ON CONFLICT (organization_id, normalized_serial).
-- ============================================================================

BEGIN;

-- 1. Drop the global natural key.
ALTER TABLE serial_units
  DROP CONSTRAINT IF EXISTS serial_units_normalized_uniq;

-- 2. Per-org natural key. (Index, not table constraint, to match the existing
--    ux_serial_units_org_unit_uid convention on this table.)
CREATE UNIQUE INDEX IF NOT EXISTS ux_serial_units_org_normalized_serial
  ON serial_units (organization_id, normalized_serial);

COMMIT;
