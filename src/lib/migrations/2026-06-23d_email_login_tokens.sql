-- ============================================================================
-- 2026-06-23d_email_login_tokens.sql
--
-- Phase F1: passwordless (magic-link) owner email login. One-time, expiring,
-- HASHED tokens (the raw token is only ever in the emailed URL; we store sha256).
--
-- This is an AUTH PRIMITIVE (resolved pre-session, by a cross-org email lookup on
-- the owner pool), so — like staff_sessions / staff_enrollments — it is NOT
-- FORCE-RLS'd; organization_id is carried for attribution + cascade cleanup only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_login_tokens (
  id              bigserial PRIMARY KEY,
  organization_id uuid    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id        integer NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  token_hash      text    NOT NULL UNIQUE,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_login_tokens_staff   ON email_login_tokens (staff_id);
CREATE INDEX IF NOT EXISTS idx_email_login_tokens_expires ON email_login_tokens (expires_at);
