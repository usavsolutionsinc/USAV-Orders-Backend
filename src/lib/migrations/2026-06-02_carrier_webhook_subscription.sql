-- Migration: carrier webhook subscription state (FedEx + UPS).
--
-- We track inbound packages on *other parties'* carrier accounts, so the only
-- viable push channel is each carrier's tracking-number subscription: every
-- number must be associated to our webhook project / destination before the
-- carrier will push near-real-time events to /api/webhooks/<carrier>.
--   FedEx — asynchronous, batched (≤1000) ADD job that returns a jobID we poll.
--   UPS   — synchronous per-number subscription with a destination URL.
-- These columns record where each shipment sits in that lifecycle so the
-- subscribe-<carrier> crons can (a) find un-subscribed shipments, (b) avoid
-- re-submitting ones already associated, and (c) retry FAILED ones. The columns
-- are carrier-agnostic; the FedEx-only `job_id` simply stays NULL for UPS.
--
-- Additive only. Polling (next_check_at) remains the fallback / missed-event
-- recovery path; nothing here changes existing sync behaviour.

ALTER TABLE shipping_tracking_numbers
  ADD COLUMN IF NOT EXISTS webhook_subscription_status  TEXT,
  ADD COLUMN IF NOT EXISTS webhook_subscribed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS webhook_subscription_job_id  TEXT,
  ADD COLUMN IF NOT EXISTS webhook_subscription_error   TEXT;

-- Mirrors FedEx's documented job states so a quick scan of the column tells
-- you the real subscription state. NULL = never attempted.
--   PENDING     — queued locally, not yet submitted to FedEx
--   SUBMITTED   — ADD request accepted, jobID issued, not yet COMPLETED
--   COMPLETED   — FedEx confirmed the association; webhooks will flow
--   FAILED      — FedEx rejected (UNACCEPTED/FAILED) or the call errored
ALTER TABLE shipping_tracking_numbers
  DROP CONSTRAINT IF EXISTS chk_webhook_subscription_status;
ALTER TABLE shipping_tracking_numbers
  ADD CONSTRAINT chk_webhook_subscription_status
    CHECK (
      webhook_subscription_status IS NULL
      OR webhook_subscription_status IN ('PENDING','SUBMITTED','COMPLETED','FAILED')
    );

-- Work-queue read path for the subscribe-<carrier> crons: "give me active
-- shipments for this carrier that still need a (re)subscription". COMPLETED rows
-- fall out of the index entirely so the scan stays cheap as the set grows.
-- Carrier leads the index so each cron hits only its own rows.
CREATE INDEX IF NOT EXISTS idx_stn_webhook_pending
  ON shipping_tracking_numbers (carrier, webhook_subscription_status, next_check_at)
  WHERE is_terminal = false
    AND (webhook_subscription_status IS NULL
         OR webhook_subscription_status IN ('PENDING','FAILED'));

-- Reconcile read path (FedEx async jobs): "give me SUBMITTED jobs whose status
-- I still need to poll back from the carrier".
CREATE INDEX IF NOT EXISTS idx_stn_webhook_submitted
  ON shipping_tracking_numbers (carrier, webhook_subscription_job_id)
  WHERE webhook_subscription_status = 'SUBMITTED';
