-- ============================================================================
-- 2026-06-21_identity_passkey_backfill.sql
--
-- IDENTITY LAYER — Phase 2c: copy existing per-staff passkeys up to the global
-- account so they work with account-level (cross-org) passkey sign-in.
--
-- staff_passkeys stores credential_id / public_key as BYTEA (decoded from the
-- browser's base64url). webauthn_credentials stores them as base64url TEXT, so
-- we re-encode: encode(bytea,'base64') → swap +/ for -_ → strip '=' padding.
--
-- account_id comes from the owning staff row (populated by
-- 2026-06-20e_identity_layer_phase1.sql). ON CONFLICT (credential_id) DO NOTHING
-- makes this idempotent and safe to re-run; staff_passkeys is left intact (the
-- staff/station passkey flow keeps using it).
-- ============================================================================

INSERT INTO webauthn_credentials
  (account_id, credential_id, public_key, sign_count, transports, aaguid, label, created_at, last_used_at)
SELECT
  s.account_id,
  rtrim(translate(encode(p.credential_id, 'base64'), '+/', '-_'), '='),
  rtrim(translate(encode(p.public_key,    'base64'), '+/', '-_'), '='),
  p.counter,
  p.transports,
  p.aaguid,
  p.device_label,
  p.created_at,
  p.last_used_at
FROM staff_passkeys p
JOIN staff s ON s.id = p.staff_id
WHERE s.account_id IS NOT NULL
ON CONFLICT (credential_id) DO NOTHING;
