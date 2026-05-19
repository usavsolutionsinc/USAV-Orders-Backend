-- ============================================================================
-- 2026-05-19: Drop legacy staff_role_chk CHECK constraint
-- ============================================================================
-- The `staff.role` column used to be an enum-like string with a CHECK that
-- whitelisted ('packer','receiving','technician','sales','admin','readonly').
-- Editable roles (2026-05-19_editable_roles.sql) moved the authoritative role
-- taxonomy into the `roles` table, where admins can add keys ('receiver',
-- 'shipper', 'inventory_manager', 'viewer', etc.). `staff.role` is now just
-- a denormalised cache of the primary role's key for legacy callers — and
-- PUT /api/admin/staff/[id]/roles keeps it in sync.
--
-- The old CHECK still rejects every role key not in its hardcoded list,
-- so assigning Receiver / Shipper / Inventory Manager / Viewer as primary
-- raises 23514 and rolls back the whole transaction. Drop it; `roles.key`
-- is the source of truth.

BEGIN;

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_chk;

COMMIT;
