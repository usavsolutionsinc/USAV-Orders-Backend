-- ============================================================================
-- 2026-06-20_zoho_webhook_org_resolution.sql
--
-- Wave 3 (tenancy): production-ready multi-tenant Zoho webhook → org resolution.
--
-- PROBLEM: Zoho webhook deliveries are authenticated by a single GLOBAL shared
-- secret (env ZOHO_WEBHOOK_SECRET), and the only tenant hint in the payload
-- (envelope.organization_id) is Zoho's internal org id, optional, and OUTSIDE
-- the HMAC — so it cannot be trusted to pick a tenant. With one shared endpoint
-- a second tenant's PO events would be processed as USAV's.
--
-- FIX (industry-standard, mirrors Stripe Connect / GitHub Apps / Square):
--   1. Each org that connects Zoho gets a per-tenant webhook URL carrying an
--      opaque, unguessable token: POST /api/zoho/webhooks/{webhook_token}.
--      The token maps O(1) to exactly one org. (This column.)
--   2. Each org gets its OWN HMAC signing secret, stored ENCRYPTED in the
--      organization_integrations payload (not here) — the delivery is verified
--      with that org's secret, so a forged body can't cross tenants.
--   3. The dedupe ledger becomes per-org so replay/idempotency is tenant-scoped
--      and two tenants can never collide on a synthetic event_id.
--
-- Pure additive + backfill. SAFE TO APPLY NOW. Does NOT enable FORCE/RLS.
-- Idempotent (re-runnable). Apply BEFORE deploying the Wave 3 code (the dedupe
-- writers reference organization_id).
-- ============================================================================

-- ── 1. Per-tenant webhook token on the central integration registry ─────────
-- Non-secret (it's a URL path component); security comes from the per-org HMAC
-- secret + the token's unguessability. Indexed for the O(1) token→org lookup.
ALTER TABLE organization_integrations
  ADD COLUMN IF NOT EXISTS webhook_token text;

-- Partial unique: at most one integration row per token; NULLs unconstrained
-- (most rows never get a webhook token).
CREATE UNIQUE INDEX IF NOT EXISTS ux_org_integrations_webhook_token
  ON organization_integrations (webhook_token)
  WHERE webhook_token IS NOT NULL;

-- ── 2. Org-scope the Zoho webhook dedupe ledger ─────────────────────────────
-- Self-heal: this table's 2026-05-14 creation migration is recorded as applied
-- in some environments where the table is nonetheless absent (Neon branch
-- divergence). Recreate it (original shape) if missing so this migration is
-- self-sufficient; the org-add + PK-swap below then runs identically whether the
-- table pre-existed or was just created.
CREATE TABLE IF NOT EXISTS zoho_webhook_events (
  event_id          TEXT PRIMARY KEY,
  event_type        TEXT NOT NULL,
  object_id         TEXT,
  event_time        TIMESTAMPTZ,
  raw_payload       JSONB NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at      TIMESTAMPTZ,
  processing_error  TEXT
);
CREATE INDEX IF NOT EXISTS idx_zoho_webhook_events_type_received
  ON zoho_webhook_events(event_type, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_zoho_webhook_events_object
  ON zoho_webhook_events(object_id)
  WHERE object_id IS NOT NULL;

ALTER TABLE zoho_webhook_events
  ADD COLUMN IF NOT EXISTS organization_id uuid;

-- Backfill existing rows to the transitional USAV org (the only tenant that has
-- received Zoho webhooks to date). Safe: all historical deliveries were USAV's.
UPDATE zoho_webhook_events
   SET organization_id = '00000000-0000-0000-0000-000000000001'::uuid
 WHERE organization_id IS NULL;

ALTER TABLE zoho_webhook_events
  ALTER COLUMN organization_id SET NOT NULL;

-- Flip the idempotency key from (event_id) to (organization_id, event_id) so a
-- replay is deduped within its own tenant and two tenants can't collide on a
-- synthetic (payload-hashed) event_id. The table has no inbound FKs, so the PK
-- swap is safe; guarded so re-runs are no-ops.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'zoho_webhook_events'::regclass
      AND conname = 'zoho_webhook_events_pkey'
  ) THEN
    ALTER TABLE zoho_webhook_events DROP CONSTRAINT zoho_webhook_events_pkey;
    RAISE NOTICE 'dropped global PK zoho_webhook_events_pkey (event_id)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'zoho_webhook_events'::regclass
      AND conname = 'zoho_webhook_events_org_event_pkey'
  ) THEN
    ALTER TABLE zoho_webhook_events
      ADD CONSTRAINT zoho_webhook_events_org_event_pkey
      PRIMARY KEY (organization_id, event_id);
    RAISE NOTICE 'added per-org PK zoho_webhook_events_org_event_pkey (organization_id, event_id)';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_zoho_webhook_events_org
  ON zoho_webhook_events (organization_id);
