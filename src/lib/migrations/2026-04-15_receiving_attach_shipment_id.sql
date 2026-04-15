-- ============================================================================
-- 2026-04-15: receiving.shipment_id
-- ============================================================================
-- Attach the canonical shipping_tracking_numbers FK to the inbound receiving
-- table so inbound packages share the same tracking identity as outbound
-- orders/tech_serial_numbers/packer_logs/orders_exceptions/sku (see
-- 2026-03-10_attach_shipment_id.sql for the outbound template).
--
-- Phase 1 of the inbound-tracking unification:
--   Phase 1 (this file) — add nullable FK, no behavior change.
--   Phase 2            — permissive shipment registration helper (code).
--   Phase 3            — Zoho sync writes shipment_id on receiving rows.
--   Phase 4            — API read path JOINs shipping_tracking_numbers.
--   Phase 5            — dual-write on physical receiving scans.
--   Phase 6            — backfill existing receiving rows.
--   Phase 9            — drop receiving.receiving_tracking_number,
--                        receiving.carrier, receiving_lines.zoho_reference_number.
--
-- The legacy TEXT columns remain untouched in this phase.
-- ============================================================================

BEGIN;

ALTER TABLE receiving
  ADD COLUMN IF NOT EXISTS shipment_id BIGINT
    REFERENCES shipping_tracking_numbers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_receiving_shipment_id
  ON receiving(shipment_id)
  WHERE shipment_id IS NOT NULL;

COMMENT ON COLUMN receiving.shipment_id IS
  'FK to shipping_tracking_numbers. Canonical inbound tracking identity — replaces the legacy receiving_tracking_number TEXT column and receiving_lines.zoho_reference_number.';

COMMIT;
