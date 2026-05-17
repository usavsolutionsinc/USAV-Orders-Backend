-- ============================================================================
-- 2026-05-18: Per-staff permission overrides
-- ============================================================================
-- Two TEXT[] columns on `staff` that layer on top of the role's base
-- permissions. Effective set = roleBase ∪ permissions_added \ permissions_removed.
--
-- Why columns and not a separate join table:
--   • Read-hot path (every authenticated request → /api/auth/session →
--     getCurrentUser) wants permissions in a single staff SELECT, no join.
--   • Admin rarely edits these; small arrays.
--   • Atomic update with the rest of the staff row (role / status changes).
--
-- Strings are validated by the application layer against `PermissionString`
-- in src/lib/auth/permissions-shared.ts. Unknown values are silently dropped
-- by `effectivePermissions()` so DB rows remain forward-compatible.
-- ============================================================================

BEGIN;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS permissions_added   TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS permissions_removed TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN staff.permissions_added   IS 'Per-staff permission grants on top of role. Strings from PermissionString.';
COMMENT ON COLUMN staff.permissions_removed IS 'Per-staff permission revokes on top of role. Strings from PermissionString.';

COMMIT;
