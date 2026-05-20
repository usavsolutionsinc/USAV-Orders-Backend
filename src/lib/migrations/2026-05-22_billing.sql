-- ============================================================================
-- 2026-05-22_billing.sql
--
-- Stripe-backed billing. One subscription row per org; entitlements are
-- derived from `plan` at the application layer so we don't have to migrate
-- when packaging changes.
--
-- stripe_events is the idempotency log for webhook deliveries — Stripe
-- guarantees at-least-once, so we de-dupe by event id.
-- ============================================================================

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  organization_id        uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_subscription_id text NOT NULL,
  stripe_customer_id     text NOT NULL,
  status                 text NOT NULL,           -- trialing | active | past_due | canceled | unpaid | paused
  plan                   text NOT NULL,
  price_id               text,
  quantity               integer NOT NULL DEFAULT 1,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  trial_end              timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_subs_status ON billing_subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_billing_subs_stripe_customer ON billing_subscriptions (stripe_customer_id);

DROP TRIGGER IF EXISTS billing_subs_touch_updated_at ON billing_subscriptions;
CREATE TRIGGER billing_subs_touch_updated_at
  BEFORE UPDATE ON billing_subscriptions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Idempotency log for Stripe webhook deliveries. Stripe guarantees
-- at-least-once; this table is how we make sure we only ACT on each event
-- once, even if Stripe retries because we replied slowly.
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id       text PRIMARY KEY,
  event_type     text NOT NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  payload        jsonb NOT NULL,
  processed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_type ON stripe_events (event_type, processed_at DESC);
