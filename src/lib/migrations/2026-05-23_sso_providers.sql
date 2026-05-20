-- ============================================================================
-- 2026-05-23_sso_providers.sql
--
-- Per-tenant SSO configuration. One row per (org, provider type, issuer) —
-- most tenants will have a single OIDC provider, but a multi-IdP enterprise
-- can add several.
--
-- client_secret is stored in the integrations vault (encrypted via the same
-- AES-256-GCM machinery as eBay/Zoho creds); this table holds only the
-- non-secret config that the auth flow needs in cleartext.
--
-- ssoSubject / ssoProvider columns on `staff` already exist from the
-- 2026-05-14_sso_foundation migration; we reuse them so an SSO-provisioned
-- staff member can fall back to PIN if the IdP is briefly unavailable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS organization_sso_providers (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_type   text NOT NULL DEFAULT 'oidc',   -- 'oidc' | 'saml' (future)
  -- OIDC issuer URL, used for discovery. e.g. https://login.acme.com
  issuer          text NOT NULL,
  client_id       text NOT NULL,
  -- Authorization + token endpoints, normally discovered from issuer/.well-known
  -- but cached here to avoid a network round-trip on every signin and to let
  -- enterprises pin a specific path. Optional — falls back to discovery.
  authorize_url   text,
  token_url       text,
  userinfo_url    text,
  jwks_url        text,
  -- Default role assigned to new staff provisioned via this IdP. Admins
  -- can change roles afterwards from the staff management page.
  default_role    text NOT NULL DEFAULT 'viewer',
  -- Auto-create staff rows on first sign-in (just-in-time provisioning).
  -- When false, only pre-invited staff (matched by ssoSubject) can sign in.
  auto_provision  boolean NOT NULL DEFAULT true,
  -- UI label for the button on the sign-in page.
  button_label    text NOT NULL DEFAULT 'Sign in with SSO',
  -- jsonb bag for forward-compat (e.g. SAML metadata, claim mappings).
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_sso_issuer
  ON organization_sso_providers (organization_id, provider_type, issuer);

CREATE INDEX IF NOT EXISTS idx_org_sso_organization
  ON organization_sso_providers (organization_id);

DROP TRIGGER IF EXISTS org_sso_touch_updated_at ON organization_sso_providers;
CREATE TRIGGER org_sso_touch_updated_at
  BEFORE UPDATE ON organization_sso_providers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Short-lived state store for the PKCE flow. Each /api/auth/sso/start
-- creates a row; /callback consumes it. Rows expire after 10 minutes via
-- the application — no cron needed; a periodic DELETE in the callback is
-- enough at this scale.
CREATE TABLE IF NOT EXISTS sso_auth_state (
  state           text PRIMARY KEY,
  provider_id     bigint NOT NULL REFERENCES organization_sso_providers(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code_verifier   text NOT NULL,
  next_path       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sso_auth_state_created
  ON sso_auth_state (created_at);
