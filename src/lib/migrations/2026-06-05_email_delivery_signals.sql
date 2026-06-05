-- email_delivery_signals — "ORDER DELIVERED" notifications parsed from the PO
-- mailbox (eBay sends these; the order number is printed in the email).
--
-- Why a dedicated table (not a column on email_missing_purchase_orders):
--   The missing-PO worklist only holds emails whose order# is NOT yet in
--   receiving. A delivery email usually IS for an order that exists in
--   receiving (just not scanned at the dock yet), so it would never get a
--   worklist row. This table records the delivery signal independently, keyed
--   by (org, gmail message, order#), so the Incoming "Delivered · not scanned"
--   surface can cross-check it against receiving_scans.
--
-- The cross-check join key is `order_number_norm`, normalized the SAME way as
-- receiving_lines.zoho_purchaseorder_number_norm and zoho_po_mirror's norm
-- column: upper(strip non-alphanumerics). eBay "12-34567-89012" → "123456789012".

BEGIN;

CREATE TABLE IF NOT EXISTS email_delivery_signals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL DEFAULT (
    COALESCE(
      NULLIF(current_setting('app.current_org', true), '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  ),
  gmail_msg_id      TEXT        NOT NULL,
  gmail_thread_id   TEXT,
  order_number      TEXT        NOT NULL,
  order_number_norm TEXT        NOT NULL,
  email_subject     TEXT,
  email_from        TEXT,
  snippet           TEXT,
  -- When the order was reported delivered (we use the email's received time).
  delivered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One row per (org, email, order#). An email that lists several orders
  -- produces one row per order; re-scanning the same email is idempotent.
  UNIQUE (organization_id, gmail_msg_id, order_number_norm)
);

-- Join key for the delivered-unscanned predicate (matches against
-- receiving_lines.zoho_purchaseorder_number_norm).
CREATE INDEX IF NOT EXISTS idx_email_delivery_signals_norm
  ON email_delivery_signals (order_number_norm);

-- Recency ordering for the details-panel email list + the 30-day window.
CREATE INDEX IF NOT EXISTS idx_email_delivery_signals_delivered_at
  ON email_delivery_signals (delivered_at DESC);

COMMIT;
