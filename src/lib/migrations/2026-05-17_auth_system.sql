-- ============================================================================
-- 2026-05-17: Global auth system (PIN + passkey + phone-pairing sessions)
-- ============================================================================
-- Adds the data model for:
--   - PIN sign-in on shared stations (staff.pin_hash + lockout columns)
--   - WebAuthn passkeys for personal devices (staff_passkeys)
--   - Server-side opaque sessions, never JWTs (staff_sessions)
--   - One-time admin-generated enrollment tokens (staff_enrollments)
--   - Short-lived step-up grants for destructive actions (staff_stepups)
--   - Auth-event audit trail (auth_audit)
--
-- All additive. Existing staff rows keep working with no changes; the old
-- staffId URL-param fallback stays valid until the AUTH_V2_ENABLED feature
-- flag flips on globally.
-- ============================================================================

BEGIN;

-- ─── staff additive columns ────────────────────────────────────────────────
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS pin_hash         TEXT,
  ADD COLUMN IF NOT EXISTS pin_set_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pin_failed_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS employee_code    TEXT,
  ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'active';

-- employee_code is staff-facing (shown on badges); enforce uniqueness only
-- where set, so existing rows without one don't all collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_employee_code
  ON staff(employee_code)
  WHERE employee_code IS NOT NULL;

-- status: 'active' (default), 'invited', 'suspended', 'disabled'.
-- No CHECK constraint — keep the column free so we can add states without
-- a migration; validation lives in the application layer.

COMMENT ON COLUMN staff.pin_hash         IS 'scrypt hash of staff PIN. Format: scrypt$N$r$p$salt_hex$key_hex.';
COMMENT ON COLUMN staff.pin_set_at       IS 'Timestamp the current PIN was set; used for "PIN age" UI hints, not for forced rotation.';
COMMENT ON COLUMN staff.pin_failed_count IS 'Consecutive failed PIN entries since last success. Cleared on successful sign-in.';
COMMENT ON COLUMN staff.pin_locked_until IS 'If set and > now(), PIN sign-in is blocked. Cleared on successful unlock path.';
COMMENT ON COLUMN staff.employee_code    IS 'Optional human-readable code (badge number). Unique when present.';
COMMENT ON COLUMN staff.status           IS 'active | invited | suspended | disabled. Free-text, validated in app layer.';

-- ─── staff_passkeys ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_passkeys (
  id            BIGSERIAL    PRIMARY KEY,
  staff_id      INTEGER      NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  credential_id BYTEA        NOT NULL UNIQUE,
  public_key    BYTEA        NOT NULL,
  counter       BIGINT       NOT NULL DEFAULT 0,
  transports    TEXT[],
  aaguid        UUID,
  device_label  TEXT,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_passkeys_staff
  ON staff_passkeys(staff_id);

COMMENT ON TABLE staff_passkeys IS 'WebAuthn credentials. One staff_id can have many (one per device).';
COMMENT ON COLUMN staff_passkeys.credential_id IS 'Raw COSE credentialId bytes returned by the authenticator.';
COMMENT ON COLUMN staff_passkeys.counter       IS 'Authenticator signature counter; bumped on every successful verify. Drop in value = possible clone.';

-- ─── staff_sessions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_sessions (
  sid           TEXT         PRIMARY KEY,
  staff_id      INTEGER      NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  device_kind   TEXT         NOT NULL,
  device_label  TEXT,
  ip            INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ  NOT NULL,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_staff_active
  ON staff_sessions(staff_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_sessions_expiry_sweep
  ON staff_sessions(expires_at) WHERE revoked_at IS NULL;

COMMENT ON TABLE staff_sessions IS 'Server-side sessions; opaque sid lives in an httpOnly cookie. Never use JWTs here.';
COMMENT ON COLUMN staff_sessions.device_kind IS 'station | personal | phone. Drives idle-timeout policy.';
COMMENT ON COLUMN staff_sessions.last_seen_at IS 'Touched on each authenticated request; idle-timeout compares against this.';

-- ─── staff_enrollments ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_enrollments (
  token        TEXT         PRIMARY KEY,
  staff_id     INTEGER      NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  created_by   INTEGER      REFERENCES staff(id) ON DELETE SET NULL,
  expires_at   TIMESTAMPTZ  NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_enrollments_staff
  ON staff_enrollments(staff_id);

COMMENT ON TABLE staff_enrollments IS 'One-time tokens an admin generates so a new staff member can set PIN + register a passkey from their phone.';

-- ─── staff_stepups ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_stepups (
  sid         TEXT         NOT NULL REFERENCES staff_sessions(sid) ON DELETE CASCADE,
  scope       TEXT         NOT NULL,
  granted_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ  NOT NULL,
  method      TEXT         NOT NULL,
  PRIMARY KEY (sid, scope)
);

COMMENT ON TABLE staff_stepups IS 'Short-lived elevated-trust grants per session+scope. Granted by fresh PIN/passkey/phone approval.';

-- ─── auth_audit ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_audit (
  id          BIGSERIAL    PRIMARY KEY,
  staff_id    INTEGER      REFERENCES staff(id) ON DELETE SET NULL,
  event       TEXT         NOT NULL,
  result      TEXT         NOT NULL,
  ip          INET,
  user_agent  TEXT,
  sid         TEXT,
  detail      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_audit_staff_time
  ON auth_audit(staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_event_time
  ON auth_audit(event, created_at DESC);

COMMENT ON TABLE auth_audit IS 'Every auth-relevant event: sign-in (ok/denied), sign-out, step-up, permission denial, enrollment consume, role change.';

COMMIT;
