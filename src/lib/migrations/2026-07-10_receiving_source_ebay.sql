-- ============================================================================
-- 2026-07-10: allow receiving.source = 'ebay' + source_order_id carton key
-- ============================================================================
-- eBay buyer purchases land on the Incoming spine via ingestPurchase. When a
-- tracking number is present, we get-or-create a pre-arrival carton
-- (source='ebay') keyed by the eBay order id so STN soft-joins work the same
-- way Zoho PO cartons do (ux_receiving_zoho_po_matched). The existing
-- receiving_source_chk only permitted zoho_po|unmatched|local_pickup|
-- sourcing_import (2026-06-06h), so this additive migration widens it and
-- adds the per-org unique partial index for the eBay carton key.
--
-- SAFETY: Additive only — existing source values remain valid. Writers that
-- create source='ebay' cartons (ensureReceivingForEbayOrder) stamp
-- organization_id and run under withTenantTransaction / the GUC. receiving
-- is already FORCE RLS (2026-06-19).
--
-- Base table is receiving_carton (2026-07-05d rename); the `receiving` compat
-- view is recreated so SELECT * picks up the new column.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS ux_receiving_ebay_order;
--   ALTER TABLE receiving_carton DROP COLUMN IF EXISTS source_order_id;
--   ALTER TABLE receiving_carton DROP CONSTRAINT IF EXISTS receiving_source_chk;
--   ALTER TABLE receiving_carton ADD CONSTRAINT receiving_source_chk
--     CHECK (source IN ('zoho_po','unmatched','local_pickup','sourcing_import'));
--   CREATE OR REPLACE VIEW receiving WITH (security_invoker = true) AS
--     SELECT * FROM receiving_carton;
-- VERIFY:
--   \d receiving_carton  — source_order_id present; receiving_source_chk includes ebay
--   \di ux_receiving_ebay_order
-- ============================================================================

BEGIN;

-- Widen the source check to include 'ebay'.
ALTER TABLE receiving_carton DROP CONSTRAINT IF EXISTS receiving_source_chk;
ALTER TABLE receiving_carton
  ADD CONSTRAINT receiving_source_chk
  CHECK (source IN ('zoho_po', 'unmatched', 'local_pickup', 'sourcing_import', 'ebay'));

-- eBay order id carton key (parallel to zoho_purchaseorder_id for zoho_po).
ALTER TABLE receiving_carton
  ADD COLUMN IF NOT EXISTS source_order_id TEXT;

COMMENT ON COLUMN receiving_carton.source_order_id IS
  'External order id carton key for non-Zoho sources (e.g. eBay order id when source=''ebay''). Soft-joined to receiving_lines.source_order_id when receiving_id is NULL.';

-- One eBay carton per (org, order id). Partial so other sources stay unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS ux_receiving_ebay_order
  ON receiving_carton (organization_id, source_order_id)
  WHERE source = 'ebay' AND source_order_id IS NOT NULL;

-- Compat view expands columns at CREATE time — recreate so source_order_id is visible.
CREATE OR REPLACE VIEW receiving
  WITH (security_invoker = true) AS
  SELECT * FROM receiving_carton;

COMMENT ON VIEW receiving IS
  'COMPAT SHIM (2026-07-05d): receiving was renamed to receiving_carton. Auto-updatable, security_invoker=true (RLS enforced per querying role). New code uses receiving_carton; this view keeps legacy raw SQL working until refs are migrated. ON CONFLICT must target receiving_carton.';

COMMIT;
