-- ============================================================================
-- 2026-05-25: Per-staff and per-role mobile display configuration
-- ============================================================================
-- Replaces the boolean staff.mobile_bottom_nav_enabled (added in the earlier
-- 2026-05-23 migration but never wired up) with a structured JSONB config.
-- Lets admins control mobile UI on a per-role and per-staff basis from
-- /admin?section=access and /admin?section=roles. Per-staff JSON overrides
-- the role defaults; unset fields fall through.
--
-- Initial v1 shape (defined in TypeScript at
-- src/lib/auth/mobile-display-config.ts — keep in sync):
--
--   {
--     "bottomNav": {
--       "enabled": boolean,
--       "tabs":   ("home" | "scan" | "picks" | "signout")[]
--     }
--   }
--
-- Why JSONB and not more columns: we expect to layer on more mobile-only
-- toggles (auto-open scanner on launch, scan-resolver default target, etc.)
-- without another migration each time. The TypeScript resolver is the source
-- of truth for shape; the DB just persists.
--
-- Defaults:
--   - Roles 'technician' and 'picker' get bottomNav.enabled = true (their
--     work flows actually use it).
--   - 'admin' also gets enabled = true so the admins testing on phones can
--     reach the standard tabs.
--   - Everyone else (packer / receiver / sales / viewer / readonly) leaves
--     mobile_defaults NULL — the resolver falls back to DEFAULT_MOBILE_DISPLAY_CONFIG
--     which is disabled. Per-staff overrides can opt in.
-- ============================================================================

BEGIN;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS mobile_display_config JSONB;

COMMENT ON COLUMN staff.mobile_display_config IS
  'Per-staff mobile UI override. JSONB matching MobileDisplayConfig (see src/lib/auth/mobile-display-config.ts). Resolver merges over roles.mobile_defaults; unset top-level keys inherit from role.';

ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS mobile_defaults JSONB;

COMMENT ON COLUMN roles.mobile_defaults IS
  'Per-role mobile UI defaults. JSONB matching MobileDisplayConfig. Staff with this role inherit these unless they have their own per-row override.';

-- Seed bottom-nav-enabled for the roles whose work uses /m/pick + /m/scan.
UPDATE roles
   SET mobile_defaults = jsonb_build_object(
         'bottomNav', jsonb_build_object(
           'enabled', true,
           'tabs',    jsonb_build_array('home', 'scan', 'picks', 'signout')
         )
       ),
       updated_at = NOW()
 WHERE key IN ('technician', 'picker', 'admin')
   AND mobile_defaults IS NULL;

COMMIT;
