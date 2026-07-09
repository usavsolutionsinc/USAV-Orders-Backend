-- ============================================================================
-- 2026-07-03s: repair_service.serial_unit_id — optional spine link (Phase 1)
-- ============================================================================
-- Phase 1 of docs/todo/schema-wide-polymorphic-refactor-plan.md ("repair
-- cluster"). The plan flagged that repair_service has NO serial_unit_id FK (it
-- re-stores serial_number as text). This adds a real, NULLABLE FK to
-- serial_units so an internal-inventory repair ticket can anchor to its unit —
-- mirroring unit_repairs' serial-anchored shape and the unit_repairs.repair_service_id
-- bridge that already exists in the other direction.
--
-- ⚠️ SCOPE CORRECTION (live-data scan 2026-07-03): the plan's broader
-- recommendation — "collapse repair_service / unit_repairs / warranty_repair_attempts
-- onto unit_repairs" — is NOT right for repair_service. It is a DISTINCT domain:
-- customer walk-in / RMA device repair (contact_info, customer_id, price,
-- ticket_number, pickup_signed_at), NOT internal inventory-serial repair. Of 72
-- rows, only 1 matches a serial_units row (13 have no serial at all); the other
-- 71 are customers' own devices that were never received as inventory and
-- correctly have no serial_unit. So this FK is an OPTIONAL enrichment (link when
-- the device happens to be an inventory unit), NOT a consolidation. unit_repairs
-- stays the inventory-serial repair model; repair_service stays the customer
-- intake model; they relate via unit_repairs.repair_service_id.
--
-- ADDITIVE + REVERSIBLE. serial_unit_id INTEGER matches serial_units.id (SERIAL).
-- repair_service is already org-scoped + FORCE-RLS (existing table).
--
-- ROLLBACK:
--   ALTER TABLE repair_service DROP COLUMN IF EXISTS serial_unit_id;
-- ============================================================================

BEGIN;

ALTER TABLE repair_service
  ADD COLUMN IF NOT EXISTS serial_unit_id INTEGER;

DO $$ BEGIN
  ALTER TABLE repair_service
    ADD CONSTRAINT repair_service_serial_unit_id_fkey
    FOREIGN KEY (serial_unit_id) REFERENCES serial_units(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_repair_service_serial_unit
  ON repair_service (organization_id, serial_unit_id);

-- Backfill: link only where the ticket's serial_number resolves to an inventory
-- unit in the same org. Customer-device tickets correctly stay NULL.
UPDATE repair_service rs
   SET serial_unit_id = su.id
  FROM serial_units su
 WHERE su.normalized_serial = upper(btrim(rs.serial_number))
   AND su.organization_id = rs.organization_id
   AND rs.serial_unit_id IS NULL
   AND rs.serial_number IS NOT NULL
   AND btrim(rs.serial_number) <> '';

COMMENT ON COLUMN repair_service.serial_unit_id IS
  'Optional link to the inventory serial_units row when the repaired device IS inventory. NULL for customer-owned devices (the common case). NOT a consolidation onto unit_repairs — repair_service is the customer-repair domain; see 2026-07-03s header.';

COMMIT;
