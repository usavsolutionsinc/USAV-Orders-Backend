-- ============================================================================
-- 2026-05-26: Per-staff session policy
-- ============================================================================
-- Adds staff.session_policy controlling how long a staff stays signed in.
-- Three values, applied on top of the device_kind windows in session.ts:
--
--   default    — existing windows (8h/24h station, 12h/30d personal, 4h/4h phone)
--   extended   — 7d idle / 90d absolute on personal devices
--                (station/phone unaffected — see session.ts)
--   persistent — no idle timeout, absolute set to 1y on create and refreshed
--                on every touch. Stays signed in indefinitely as long as the
--                staff keeps using the device. Still revocable.
--
-- Default value is 'default' so existing rows behave exactly as before.
-- ============================================================================

BEGIN;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS session_policy TEXT NOT NULL DEFAULT 'default'
    CHECK (session_policy IN ('default', 'extended', 'persistent'));

COMMENT ON COLUMN staff.session_policy IS
  'How long this staff stays signed in. See src/lib/auth/session.ts for the windows each value maps to.';

COMMIT;
