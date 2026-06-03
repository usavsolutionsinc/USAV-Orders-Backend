-- Idempotency + audit ledger for the shipped-order → Zoho Inventory fulfillment sync.
--
-- One row per internal order (keyed by reference_number = orders.order_id, the
-- channel/marketplace order id). Each Zoho artifact created for that order —
-- sales order, package, shipment order, invoice — is recorded here so the sync
-- can be re-run safely without creating duplicates, and so we keep a durable
-- audit trail of exactly what landed in Zoho and when.
--
-- This table is the source of truth for the fulfillment sync's idempotency.
-- The pre-existing mirror tables (packages, shipment_orders, invoices) remain
-- the Zoho-pull mirror and are intentionally NOT written by this push sync.

CREATE TABLE IF NOT EXISTS zoho_fulfillment_sync (
  id                  BIGSERIAL PRIMARY KEY,
  organization_id     UUID,
  reference_number    TEXT NOT NULL UNIQUE,   -- = orders.order_id (channel order id)
  channel             TEXT,

  -- Zoho record ids, filled in step by step (NULL until that step succeeds).
  zoho_salesorder_id  TEXT,
  zoho_package_id     TEXT,
  zoho_shipment_id    TEXT,
  zoho_invoice_id     TEXT,
  invoice_status      TEXT,                   -- draft | sent | paid

  -- Progress + outcome.
  stage               TEXT NOT NULL DEFAULT 'pending',
                      -- pending|salesorder|package|shipment|delivered|invoice|completed
  status              TEXT NOT NULL DEFAULT 'pending',
                      -- pending|completed|error|dry_run|skipped
  delivered           BOOLEAN NOT NULL DEFAULT FALSE,

  -- Shipment facts (denormalized for quick audit/reporting).
  carrier             TEXT,
  tracking_number     TEXT,

  -- Change detection: hash of the source order snapshot. Lets a completed
  -- order be skipped on subsequent runs unless its shipment/lines changed.
  source_hash         TEXT,

  attempts            INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  dry_run             BOOLEAN NOT NULL DEFAULT FALSE,

  raw                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zfs_status_idx       ON zoho_fulfillment_sync (status);
CREATE INDEX IF NOT EXISTS zfs_updated_at_idx   ON zoho_fulfillment_sync (updated_at);
CREATE INDEX IF NOT EXISTS zfs_salesorder_idx   ON zoho_fulfillment_sync (zoho_salesorder_id);
