-- ============================================================================
-- 2026-05-19: Editable roles + multi-role assignment (Discord-style)
-- ============================================================================
-- Two new tables that let admins edit role→permission mappings from the UI
-- and assign multiple roles to a single staff:
--
--   roles         — editable taxonomy. `key` is the stable slug; `permissions`
--                   is a TEXT[] of PermissionString values from
--                   src/lib/auth/permissions-shared.ts. `is_system=true` rows
--                   are seeded built-ins that can't be deleted.
--   staff_roles   — many-to-many junction. Composite PK (staff_id, role_id).
--
-- The seed script (scripts/seed-roles.mjs) populates `roles` from the current
-- static matrix and back-fills `staff_roles` from the existing staff.role
-- column. The staff.role column stays populated as the "primary role" so
-- legacy queries continue to work.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS roles (
  id           SERIAL PRIMARY KEY,
  key          TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  color        VARCHAR(7) NOT NULL DEFAULT '#6b7280',
  position     INTEGER NOT NULL DEFAULT 100,
  permissions  TEXT[] NOT NULL DEFAULT '{}',
  is_system    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_roles_position ON roles(position);

CREATE TABLE IF NOT EXISTS staff_roles (
  staff_id    INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  role_id     INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by  INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  PRIMARY KEY (staff_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_staff_roles_role ON staff_roles(role_id);

COMMENT ON TABLE roles IS 'Editable role taxonomy. is_system rows are seeded built-ins and cannot be deleted.';
COMMENT ON COLUMN roles.position IS 'Lower numbers = higher priority. Primary role = lowest position assigned to a staff.';
COMMENT ON COLUMN roles.permissions IS 'PermissionString values from src/lib/auth/permissions-shared.ts. Unknown strings ignored by the resolver.';
COMMENT ON TABLE staff_roles IS 'Many-to-many: a staff can hold several roles. Effective permissions = UNION of role perms ∪ staff overrides.';

COMMIT;
