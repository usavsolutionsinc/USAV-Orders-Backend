-- ============================================================================
-- 2026-05-24_ebay_api_calls.sql
--
-- Table to log outgoing eBay API requests with their latency, endpoints,
-- status codes, and error messages.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ebay_api_calls (
  id              serial PRIMARY KEY,
  organization_id uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  endpoint        text NOT NULL,
  method          text NOT NULL,
  latency_ms      integer NOT NULL,
  status_code     integer NOT NULL,
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ebay_api_calls_organization ON ebay_api_calls (organization_id);

ALTER TABLE ebay_api_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ebay_api_calls_tenant_isolation ON ebay_api_calls;
CREATE POLICY ebay_api_calls_tenant_isolation ON ebay_api_calls USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
