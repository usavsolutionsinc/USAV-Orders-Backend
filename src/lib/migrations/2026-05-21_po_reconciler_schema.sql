-- PO email-reconciler schema (Phase 1).
--
--  1. Normalized lookup key on receiving_lines so the email order-number
--     extractor can match Zoho POs without per-row normalization at query
--     time. Generated STORED column + partial index.
--
--  2. email_missing_orders worklist table — one row per scanned Gmail
--     message that had no Zoho match. Self-heals via Phase 5 update query
--     when a missing PO later shows up in receiving_lines.
--
-- Normalization rule (must match src/lib/po-gmail/extract.ts):
--   uppercase, strip everything that isn't [A-Za-z0-9]
--     "PO-00123"  → "PO00123"
--     "po 123"    → "PO123"
--     "ACME-A99"  → "ACMEA99"
--
-- Note on reference_number: zoho_reference_number was dropped from
-- receiving_lines in 2026-04-15 and now lives on shipping_tracking_numbers
-- (joined via receiving.shipment_id). If real emails reveal we need to
-- match the vendor's reference, we'll add a view that joins it back in.
-- For Phase 1 we match on Zoho's PO number only — the dominant case.

BEGIN;

-- ── 1. Normalized PO# column on receiving_lines ───────────────────────────

ALTER TABLE receiving_lines
  ADD COLUMN IF NOT EXISTS zoho_purchaseorder_number_norm TEXT
    GENERATED ALWAYS AS (
      NULLIF(upper(regexp_replace(zoho_purchaseorder_number, '[^A-Za-z0-9]', '', 'g')), '')
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_receiving_lines_zoho_po_number_norm
  ON receiving_lines (zoho_purchaseorder_number_norm)
  WHERE zoho_purchaseorder_number_norm IS NOT NULL;


-- ── 2. email_missing_orders worklist ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_missing_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT (
    COALESCE(
      NULLIF(current_setting('app.current_org', true), '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  ),
  gmail_msg_id    TEXT        NOT NULL,
  gmail_thread_id TEXT,
  po_numbers      TEXT[]      NOT NULL,
  po_numbers_norm TEXT[]      NOT NULL,
  email_subject   TEXT,
  email_from      TEXT,
  email_received  TIMESTAMPTZ,
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'ignored', 'resolved')),
  notes           TEXT,
  resolved_at     TIMESTAMPTZ,
  UNIQUE (organization_id, gmail_msg_id)
);

CREATE INDEX IF NOT EXISTS idx_email_missing_orders_org_status_scanned
  ON email_missing_orders (organization_id, status, scanned_at DESC);

-- GIN on the normalized array makes the auto-resolve UPDATE (Phase 5) cheap.
CREATE INDEX IF NOT EXISTS idx_email_missing_orders_po_norm_gin
  ON email_missing_orders USING GIN (po_numbers_norm);

COMMIT;
