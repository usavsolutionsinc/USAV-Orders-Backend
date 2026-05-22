-- zoho_po_mirror — read-only mirror of Zoho Inventory purchase orders
-- used by the PO email reconciler. Distinct from receiving_lines, which
-- tracks the warehouse inbound workflow (EXPECTED → ARRIVED → ...).
--
-- Why a separate table:
--   The receiving workflow shouldn't surface every Zoho PO ever (closed,
--   cancelled, drop-shipped, vendor-direct). Operators only act on POs
--   that need physical handling. This mirror exists purely so the email
--   reconciler can answer "does Zoho know about this PO?" without
--   polluting any operator queue.
--
-- One row per PO (header). Line items live in `raw` jsonb if we need them
-- later; the reconciler only matches on PO number.

BEGIN;

CREATE TABLE IF NOT EXISTS zoho_po_mirror (
  zoho_purchaseorder_id            TEXT PRIMARY KEY,
  zoho_purchaseorder_number        TEXT NOT NULL,
  zoho_purchaseorder_number_norm   TEXT GENERATED ALWAYS AS (
    NULLIF(upper(regexp_replace(zoho_purchaseorder_number, '[^A-Za-z0-9]', '', 'g')), '')
  ) STORED,
  vendor_id                        TEXT,
  vendor_name                      TEXT,
  status                           TEXT,
  po_date                          DATE,
  expected_delivery_date           DATE,
  reference_number                 TEXT,
  total                            NUMERIC(14,2),
  currency                         TEXT,
  raw                              JSONB NOT NULL,
  last_modified_zoho               TIMESTAMPTZ,
  last_synced_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zoho_po_mirror_number_norm
  ON zoho_po_mirror (zoho_purchaseorder_number_norm)
  WHERE zoho_purchaseorder_number_norm IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_zoho_po_mirror_last_synced_at
  ON zoho_po_mirror (last_synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_zoho_po_mirror_status
  ON zoho_po_mirror (status)
  WHERE status IS NOT NULL;

COMMIT;
