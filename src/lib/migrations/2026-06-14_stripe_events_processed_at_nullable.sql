-- ============================================================================
-- 2026-06-14_stripe_events_processed_at_nullable.sql
--
-- Repurpose stripe_events.processed_at from "recorded-at" to "successfully-
-- handled-at". The billing webhook now stamps it (markStripeEventProcessed)
-- ONLY after the handler fully succeeds; recordStripeEvent() treats a row with
-- processed_at IS NULL as not-yet-handled and reprocesses it on Stripe's
-- redelivery, and the webhook returns non-2xx on handler error so Stripe
-- actually retries. Previously a transient handler error returned 200 and the
-- redelivery was dropped as a duplicate — losing the subscription/plan mirror.
--
-- Was: processed_at timestamptz NOT NULL DEFAULT now() (set at INSERT time).
-- Now: nullable, no default (NULL until the handler succeeds).
--
-- Existing rows already hold a now() value (they were handled), so they remain
-- "processed" with no backfill. The idx_stripe_events_type index on
-- (event_type, processed_at DESC) is unaffected (nullable is fine in an index).
--
-- Idempotent + roll-forward only. Safe to apply before OR after the code deploy:
-- the webhook INSERT does not set processed_at, so pre-migration it still
-- defaults to now() (old skip-dupes behavior) and post-migration it is NULL.
-- ============================================================================

ALTER TABLE stripe_events ALTER COLUMN processed_at DROP NOT NULL;
ALTER TABLE stripe_events ALTER COLUMN processed_at DROP DEFAULT;
