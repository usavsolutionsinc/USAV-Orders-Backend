-- Idempotency table for Zoho webhook deliveries.
-- Zoho retries on non-2xx responses (and occasionally re-delivers on flaky
-- network). We capture every event we successfully process so a re-delivery
-- of the same event_id is a no-op.

CREATE TABLE IF NOT EXISTS zoho_webhook_events (
  -- Stable id Zoho stamps onto every delivery. When the provider doesn't
  -- supply one (some Workflow Rule webhooks don't), the receiver synthesizes
  -- a deterministic hash of (event_type + object_id + event_time).
  event_id          TEXT PRIMARY KEY,

  -- Logical event name, e.g. "purchaseorder.created", "purchasereceive.deleted".
  event_type        TEXT NOT NULL,

  -- Zoho object id (purchaseorder_id, purchase_receive_id, item_id, …).
  object_id         TEXT,

  -- Original Zoho event timestamp (ISO 8601 / RFC 3339 string).
  event_time        TIMESTAMPTZ,

  -- Verbatim payload, kept for replay / audit. Capped via TOAST.
  raw_payload       JSONB NOT NULL,

  -- Lifecycle bookkeeping.
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at      TIMESTAMPTZ,
  processing_error  TEXT
);

CREATE INDEX IF NOT EXISTS idx_zoho_webhook_events_type_received
  ON zoho_webhook_events(event_type, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_zoho_webhook_events_object
  ON zoho_webhook_events(object_id)
  WHERE object_id IS NOT NULL;
