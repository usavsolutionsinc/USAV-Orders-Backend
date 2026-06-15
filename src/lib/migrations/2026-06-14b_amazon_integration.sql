-- ============================================================================
-- 2026-06-14b: Amazon SP-API integration — connection + order import (Phase 1)
-- ============================================================================
-- Connect Amazon via OAuth on the Connections screen (multi-tenant; each org
-- connects its own seller account) and import Amazon sales orders into
-- sales_orders (local-only, no Zoho). See docs/amazon-sp-api-order-import-plan.md.
--
-- Mirrors the eBay shape: amazon_accounts ≈ ebay_accounts (per-account metadata
-- + watermark + atomic-claim col), amazon_api_calls ≈ ebay_api_calls (per-call
-- audit). The per-seller LWA refresh token itself lives encrypted in
-- organization_integrations (provider='amazon', scope='seller-{id}') — NOT here.
--
-- SP-API is LWA-only since 2023-10-02 (no AWS IAM/SigV4). Cached LWA access
-- tokens (1h TTL) are stored encrypted-at-rest when INTEGRATION_KMS_KEY is set.
--
-- org_id carries the GUC default so a forgotten explicit value still attributes
-- to the current tenant once RLS is forced. All routes pass it explicitly and
-- run under withTenantConnection/tenantQuery.
--
-- Additive + idempotent.
-- ============================================================================

-- ── Per-account metadata + sync state ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS amazon_accounts (
  id                       bigserial PRIMARY KEY,
  organization_id          uuid NOT NULL
                             DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  account_name             varchar(80) NOT NULL,            -- display label on the Connections screen
  seller_id                varchar(64),                     -- Amazon Selling Partner ID (from OAuth)
  region                   text NOT NULL DEFAULT 'NA',      -- 'NA' | 'EU' | 'FE'
  marketplace_ids          jsonb NOT NULL DEFAULT '[]'::jsonb,  -- ['ATVPDKIKX0DER', …]
  access_token             text,                            -- cached LWA access token (encrypted at rest when KMS set)
  access_token_expires_at  timestamptz,
  last_updated_watermark   timestamptz,                     -- incremental cursor (Orders getOrders LastUpdatedAfter)
  sync_started_at          timestamptz,                     -- atomic-claim col for concurrency-safe cron
  last_sync_at             timestamptz,
  status                   text NOT NULL DEFAULT 'active',  -- active | error | revoked
  last_error               text,
  is_active                boolean NOT NULL DEFAULT true,
  created_by               integer REFERENCES staff(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- One account label per org; one seller per org. ON CONFLICT (org, account_name)
-- backs the upsert in the OAuth callback / connect routes.
CREATE UNIQUE INDEX IF NOT EXISTS ux_amazon_accounts_org_name
  ON amazon_accounts (organization_id, account_name);
CREATE UNIQUE INDEX IF NOT EXISTS ux_amazon_accounts_org_seller
  ON amazon_accounts (organization_id, seller_id)
  WHERE seller_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amazon_accounts_org
  ON amazon_accounts (organization_id);

-- ── Per-call API audit (mirror of ebay_api_calls) ──────────────────────────
CREATE TABLE IF NOT EXISTS amazon_api_calls (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL
                    DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  account_id      bigint REFERENCES amazon_accounts(id) ON DELETE SET NULL,
  operation       text NOT NULL,            -- e.g. 'getMarketplaceParticipations', 'getOrders'
  method          text,
  path            text,
  status_code     integer,
  ok              boolean,
  rate_limit      text,                     -- x-amzn-RateLimit-Limit header value (for tuning)
  duration_ms     integer,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_amazon_api_calls_org_created
  ON amazon_api_calls (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_amazon_api_calls_account
  ON amazon_api_calls (account_id);
