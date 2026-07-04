-- ============================================================================
-- 2026-07-04b: ai_usage_events (per-org AI metering) + entity_search_docs
--              .embedded_model (per-org embedding-space integrity)
-- ============================================================================
-- Per-org AI provider rollout (docs/ai-search-modernization-plan.md, Phase 3+):
-- tenants connect their own AI provider (vault) or ride the platform-metered
-- default; usage is metered per org for the settings price breakdown and the
-- Stripe margin billing (meter events reporter, env-gated).
--
-- ai_usage_events — one row per billable AI call (query embed, worker embed
-- batch, Ask-AI tool call). Typed-fact table per the polymorphic contract
-- where applicable: named CHECK discriminators, org-led indexes,
-- tenant-from-birth. cost_microcents = ESTIMATED provider cost in millionths
-- of a cent (integer math; 1_000_000 microcents = 1 cent) computed from the
-- model price map at write time — the billed price applies the margin at
-- display/report time, so a margin change never rewrites history.
--
-- entity_search_docs.embedded_model — which model produced the stored vector.
-- With per-org providers, each org's docs + queries must share ONE embedding
-- space; a provider/model switch re-enqueues that org's docs (the connect
-- route does this) and the worker re-embeds. NULL = embedded before this
-- migration (treated as "unknown", re-embedded by the model-mismatch sweep).
--
-- ROLLBACK:
--   ALTER TABLE entity_search_docs DROP COLUMN IF EXISTS embedded_model;
--   DROP TABLE IF EXISTS ai_usage_events;
-- ============================================================================

BEGIN;

ALTER TABLE entity_search_docs ADD COLUMN IF NOT EXISTS embedded_model TEXT;

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  UUID NOT NULL,            -- NO default; enforce_tenant_isolation() installs it
  capability       TEXT NOT NULL,            -- chat | embed
  provider         TEXT NOT NULL,            -- ai_gateway | openai | anthropic | ollama | platform
  model            TEXT NOT NULL,
  context          TEXT NOT NULL,            -- query_embed | doc_embed | ask_ai
  input_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  /** Estimated PROVIDER cost, microcents (1e-8 USD). NULL = unknown model rate. */
  cost_microcents  BIGINT,
  /** Set once the usage has been reported to a Stripe billing meter. */
  stripe_reported_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_capability_chk
    CHECK (capability IN ('chat','embed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_context_chk
    CHECK (context IN ('query_embed','doc_embed','ask_ai'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Org-led: the settings breakdown reads month windows per org.
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_org_created
  ON ai_usage_events (organization_id, created_at DESC);

-- Stripe reporter drain: unreported rows, oldest first.
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_unreported
  ON ai_usage_events (id)
  WHERE stripe_reported_at IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('ai_usage_events');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — ai_usage_events left without FORCE RLS';
  END IF;
END $$;

COMMENT ON TABLE ai_usage_events IS
  'Per-org AI usage metering (embeds + Ask-AI calls): tokens + estimated provider cost. Feeds the Settings→AI price breakdown and the env-gated Stripe meter reporter. See docs/ai-search-modernization-plan.md.';

COMMIT;
