-- ============================================================================
-- 2026-06-20e_identity_layer_phase1.sql
--
-- IDENTITY LAYER — Phase 1 (additive, non-breaking).
--
-- Introduces a global identity layer ABOVE the per-org `staff` row so one human
-- can belong to many organizations. Design: docs/identity-layer-plan.md.
--
--   accounts              the human (global login identity) — NOT org-scoped
--   account_emails        verified emails (the cross-org match key)
--   account_identities    federated logins (google/microsoft/saml/oidc/password)
--   webauthn_credentials  passkeys, lifted from per-staff to per-account
--   account_mfa           TOTP + recovery codes
--   auth_events           append-only auth audit (login/logout/switch_org)
--   memberships           account × org bridge (the authoritative "who is where")
--   org_invitations       invite-by-email on-ramp (account may not exist yet)
--
-- `staff` is DEMOTED to the per-org operational profile (pin/color/role/station)
-- and gains account_id + membership_id. EVERY existing staff.id FK is untouched.
--
-- ── RLS POSTURE (critical — read before adding policies) ────────────────────
-- The identity tables are GLOBAL by design: they are read at login, BEFORE any
-- org context (app.current_org) exists. They therefore must NOT carry the
-- tenant_isolation policy — doing so would deadlock login. They have no
-- organization_id column, so enforce_tenant_isolation() does not apply.
--
-- `memberships` DOES have org_id, but the identity path queries it by
-- account_id ACROSS orgs (to list "all my workspaces" for the switcher). It is
-- therefore intentionally LEFT UN-FORCED in this phase and access is enforced
-- in the data-access layer (src/lib/identity/*). A future migration may add a
-- bespoke dual-key policy (org-scoped for admin member lists, account-scoped
-- for the switcher) once the routes are split — consistent with the opt-in,
-- per-table rollout in 2026-06-14_rls_enforcement_infra.sql.
--
-- When the non-BYPASSRLS `app_tenant` role goes live (Phase E1), it needs table
-- privileges on these un-RLS'd tables. Conditional GRANTs at the bottom handle
-- that the moment the role exists.
--
-- Idempotent: CREATE ... IF NOT EXISTS throughout; the backfill only touches
-- staff rows whose account_id is still NULL.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ── Identity: accounts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalized pointer to the primary verified email (authoritative copy
  -- lives in account_emails). Nullable: pre-email staff backfill leaves it null.
  primary_email text,
  display_name  text,
  status        text NOT NULL DEFAULT 'active',  -- active | suspended | deleted
  kind          text NOT NULL DEFAULT 'human',   -- human | service
  password_hash text,                            -- argon2id (algo+params encoded)
  -- Carried up from staff at backfill so existing SSO logins keep resolving.
  sso_provider  text,
  sso_subject   text,
  mfa_enabled   boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

-- ── Identity: verified emails (the cross-org match key) ─────────────────────
CREATE TABLE IF NOT EXISTS account_emails (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email       text NOT NULL,
  verified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Case-insensitive global uniqueness without requiring the citext extension.
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_emails_email ON account_emails (lower(email));
CREATE INDEX IF NOT EXISTS idx_account_emails_account ON account_emails (account_id);

-- ── Identity: federated logins ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS account_identities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider      text NOT NULL,                   -- google | microsoft | saml:<org> | password
  subject       text NOT NULL,                   -- provider's stable subject id
  email_at_link text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);
CREATE INDEX IF NOT EXISTS idx_account_identities_account ON account_identities (account_id);

-- ── Identity: passkeys (account-level) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key    text NOT NULL,
  sign_count    bigint NOT NULL DEFAULT 0,
  transports    text[],
  aaguid        uuid,
  label         text,
  last_used_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_account ON webauthn_credentials (account_id);

-- ── Identity: MFA ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS account_mfa (
  account_id     uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  totp_secret    text,
  recovery_codes text[],                          -- hashed
  confirmed_at   timestamptz
);

-- ── Identity: auth audit ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_events (
  id          bigserial PRIMARY KEY,
  account_id  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  org_id      uuid,                               -- nullable: pre-org events
  event       text NOT NULL,                      -- login | logout | switch_org | failed_login | mfa_challenge
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_events_account ON auth_events (account_id, created_at DESC);

-- ── Membership: account × org bridge ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'active',     -- invited | active | suspended | removed
  invited_by  uuid REFERENCES accounts(id),
  joined_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships (org_id);
CREATE INDEX IF NOT EXISTS idx_memberships_account ON memberships (account_id);

-- ── Invitations: invite-by-email on-ramp ────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role_key    text,
  token_hash  text NOT NULL,
  invited_by  uuid REFERENCES accounts(id),
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_invitations_org ON org_invitations (org_id);
CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON org_invitations (lower(email));
-- At most one PENDING invite per (org, email): re-inviting refreshes the row
-- (createInvitation upserts on this index) instead of stacking duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invitations_pending
  ON org_invitations (org_id, lower(email)) WHERE accepted_at IS NULL;

-- ── staff demotion: link each seat to its account + membership ──────────────
ALTER TABLE staff ADD COLUMN IF NOT EXISTS account_id    uuid REFERENCES accounts(id);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS membership_id uuid REFERENCES memberships(id);
CREATE INDEX IF NOT EXISTS idx_staff_account ON staff (account_id);

-- ── Backfill: one account + one membership per existing staff row ───────────
-- Each existing staff becomes its own account initially. Admins MERGE accounts
-- that are the same human across orgs later, by verified email — that merge is
-- what actually lights up multi-org switching. Correlated per-row so generated
-- uuids map back to the right staff. Idempotent via the NULL guard.
DO $$
DECLARE
  r          RECORD;
  v_account  uuid;
  v_member   uuid;
BEGIN
  FOR r IN
    SELECT id, name, organization_id, sso_provider, sso_subject, last_login_at, created_at
      FROM staff
     WHERE account_id IS NULL
  LOOP
    INSERT INTO accounts (display_name, sso_provider, sso_subject, last_login_at, created_at)
    VALUES (r.name, r.sso_provider, r.sso_subject, r.last_login_at, COALESCE(r.created_at, now()))
    RETURNING id INTO v_account;

    INSERT INTO memberships (account_id, org_id, status, joined_at, created_at)
    VALUES (v_account, r.organization_id, 'active', COALESCE(r.created_at, now()), COALESCE(r.created_at, now()))
    RETURNING id INTO v_member;

    UPDATE staff SET account_id = v_account, membership_id = v_member WHERE id = r.id;
  END LOOP;
END $$;

-- ── Forward-compat GRANTs for the future non-BYPASSRLS app_tenant role ──────
-- These tables carry NO tenant_isolation policy (identity is cross-org), so the
-- app_tenant role reaches them via plain table privileges once it exists. No-op
-- until the role is created (Phase E1). Mirrors the hermes_agent guard pattern.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      accounts, account_emails, account_identities, webauthn_credentials,
      account_mfa, auth_events, memberships, org_invitations
      TO app_tenant;
    GRANT USAGE, SELECT ON SEQUENCE auth_events_id_seq TO app_tenant;
  END IF;
END $$;
