-- ============================================================================
-- 2026-06-20_api_idempotency_org_scope.sql   (Phase B — the 7th deferred table)
--
-- Wave 6: org-scope the api_idempotency_responses cache. This is a genuine
-- isolation bug, not just FORCE scaffolding: the cache keys on
-- (idempotency_key, route) GLOBALLY, so without org-scoping a request from org B
-- carrying an idempotency_key that org A already used would be served org A's
-- cached response body — a cross-tenant data leak through the idempotency cache.
--
-- FIX (leak-closing, deploy-order SAFE):
--   - add organization_id (NOT NULL, USAV-backfilled — all existing rows are USAV);
--   - the matching app code (src/lib/api-idempotency.ts) now org-filters the READ
--     and stamps org on WRITE, which is what CLOSES the leak.
--   - the PRIMARY KEY stays (idempotency_key, route) on purpose: flipping it to a
--     composite (organization_id, idempotency_key, route) would require changing
--     the writer's ON CONFLICT target in lockstep — the bose deploy-ordering trap.
--     With the org-filtered read, a cross-org key collision can't leak (org B's
--     read misses org A's row); the only residual is that org B's response for a
--     colliding key isn't cached (its INSERT hits ON CONFLICT DO NOTHING). That is
--     a minor correctness degradation, not a leak.
--
-- FOLLOW-UP (true per-tenant idempotency, when 2nd tenant goes live): flip the PK
-- to (organization_id, idempotency_key, route) AND the code's ON CONFLICT target
-- in one atomic change. Tracked in docs/tenancy/SESSION-2026-06-19-route-hardening.md.
--
-- Additive + backfill. SAFE TO APPLY NOW. Idempotent. Apply with the code deploy.
-- ============================================================================

ALTER TABLE api_idempotency_responses
  ADD COLUMN IF NOT EXISTS organization_id uuid;

-- Backfill existing rows to USAV (the only tenant that has cached responses).
UPDATE api_idempotency_responses
   SET organization_id = '00000000-0000-0000-0000-000000000001'::uuid
 WHERE organization_id IS NULL;

ALTER TABLE api_idempotency_responses
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN organization_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;

ALTER TABLE api_idempotency_responses DROP CONSTRAINT IF EXISTS api_idempotency_responses_organization_fk;
ALTER TABLE api_idempotency_responses
  ADD CONSTRAINT api_idempotency_responses_organization_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- Supports the org-filtered lookup (organization_id, idempotency_key, route).
CREATE INDEX IF NOT EXISTS idx_api_idempotency_org_key_route
  ON api_idempotency_responses (organization_id, idempotency_key, route);

-- ARMED (non-FORCE) policy; inert under the bypass owner role until E1.
ALTER TABLE api_idempotency_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS api_idempotency_responses_tenant_isolation ON api_idempotency_responses;
CREATE POLICY api_idempotency_responses_tenant_isolation ON api_idempotency_responses
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
