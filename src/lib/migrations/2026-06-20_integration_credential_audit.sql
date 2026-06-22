-- ============================================================================
-- 2026-06-20_integration_credential_audit.sql
--
-- Wave 5 (tenancy): audit trail for integration CREDENTIAL usage.
--
-- Records when an org's stored credential is used to perform a provider
-- operation, plus every DENIED attempt (operation not on the credential
-- allowlist) and per-operation ERRORs. This is the security ledger for the
-- credential-scope layer (src/lib/integrations/credential-scope.ts):
--   - 'allowed' rows are throttled (one per org/provider/operation per window)
--     so a high-frequency sync doesn't amplify writes;
--   - 'denied'/'error' rows are always written (low frequency, security-relevant).
--
-- Additive, idempotent. SAFE TO APPLY NOW. The writer is best-effort and
-- swallows a missing table, so code works before this is applied.
-- ============================================================================

CREATE TABLE IF NOT EXISTS integration_credential_audit (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL,
  provider        text NOT NULL,
  scope           text,
  operation       text NOT NULL,            -- e.g. 'purchaseorders.read'
  outcome         text NOT NULL,            -- 'allowed' | 'denied' | 'error'
  detail          text,                     -- denial reason / error message (truncated)
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integration_credential_audit_org
  ON integration_credential_audit (organization_id, provider, created_at DESC);

-- Surface denials fast for alerting/triage.
CREATE INDEX IF NOT EXISTS idx_integration_credential_audit_denied
  ON integration_credential_audit (created_at DESC)
  WHERE outcome <> 'allowed';
