-- ============================================================================
-- 2026-05-22_organization_integrations.sql
--
-- Per-tenant integration credentials. Replaces the env-var-only model that
-- hard-coded USAV's eBay/Zoho/Ecwid/UPS/FedEx/USPS/Zendesk credentials into
-- the deployment.
--
-- payload_encrypted is AES-256-GCM ciphertext of a JSON document specific
-- to the provider — see src/lib/integrations/credentials.ts. The key lives
-- in INTEGRATION_KMS_KEY (32 raw bytes base64-encoded).
-- ============================================================================

CREATE TABLE IF NOT EXISTS organization_integrations (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider        text NOT NULL,            -- 'ebay'|'zoho'|'ecwid'|'square'|'ups'|'fedex'|'usps'|'zendesk'|'google_sheets'|'ably'|'ollama'|'stripe'
  -- AES-256-GCM ciphertext, base64. Format: <iv-12b><tag-16b><ciphertext>.
  payload_encrypted text NOT NULL,
  -- Cheap, non-secret status fields for the admin UI without needing to
  -- decrypt the payload (e.g. "Connected as foo@example.com").
  display_label   text,
  status          text NOT NULL DEFAULT 'active', -- active | error | revoked
  last_used_at    timestamptz,
  last_error      text,
  -- Optional per-provider scope when one org has multiple accounts (e.g.
  -- multiple eBay storefronts). NULL for the common single-account case.
  scope           text,
  created_by      integer REFERENCES staff(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_integrations_provider_scope
  ON organization_integrations (organization_id, provider, COALESCE(scope, ''));

CREATE INDEX IF NOT EXISTS idx_org_integrations_org
  ON organization_integrations (organization_id);

DROP TRIGGER IF EXISTS org_integrations_touch_updated_at ON organization_integrations;
CREATE TRIGGER org_integrations_touch_updated_at
  BEFORE UPDATE ON organization_integrations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
