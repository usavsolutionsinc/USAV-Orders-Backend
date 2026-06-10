-- ============================================================================
-- 2026-06-09: receiving_shipments — PO ↔ shipment junction (multi-box per PO)
-- ============================================================================
-- docs/multi-tracking-po-plan.md — Phase 1 (additive).
--
-- Today a PO collapses to one `receiving` row pinned to ONE tracking number
-- (the Zoho reference#, via `receiving.shipment_id`). A vendor that ships a PO
-- as N cartons (N carrier labels) can therefore only be found by the single
-- reference# label; scanning the other boxes dead-ends as unfound/NO_PO.
--
-- This junction makes PO ↔ shipment MANY-to-many WITHOUT touching the anchor:
--   • The primary box stays `receiving.shipment_id` = the reference# tracking;
--     it is mirrored here as the `is_primary` row (box_seq 1).
--   • Extra boxes are attached here (box_seq 2..N) via the new
--     /api/receiving/[id]/attach-box endpoint — the existing lookup-po resolve
--     path and the ux_receiving_zoho_po_matched one-row-per-PO constraint are
--     untouched.
--   • It also models the reverse case (one shipment shared by several POs →
--     several junction rows) that lookup-po already flags as multi_po_warning.
--
-- Additive + idempotent. Backfill of existing primaries is a separate step:
-- scripts/backfill-receiving-shipments.sql (the attach-box endpoint also
-- self-heals the primary row per-carton, so the backfill is convenience only).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS receiving_shipments (
  id            BIGSERIAL PRIMARY KEY,
  receiving_id  INTEGER  NOT NULL REFERENCES receiving(id) ON DELETE CASCADE,
  shipment_id   BIGINT   NOT NULL REFERENCES shipping_tracking_numbers(id) ON DELETE CASCADE,
  -- 1 = primary (the reference# tracking). Extra boxes get 2..N in attach order.
  box_seq       INTEGER  NOT NULL DEFAULT 1,
  -- Exactly one row per carton is the primary (the Zoho reference# anchor).
  is_primary    BOOLEAN  NOT NULL DEFAULT false,
  received_at   TIMESTAMPTZ,
  received_by   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ux_receiving_shipments UNIQUE (receiving_id, shipment_id)
);

CREATE INDEX IF NOT EXISTS idx_receiving_shipments_receiving
  ON receiving_shipments(receiving_id);
CREATE INDEX IF NOT EXISTS idx_receiving_shipments_shipment
  ON receiving_shipments(shipment_id);

-- At most one primary box per carton (the reference# anchor). Partial unique so
-- the many non-primary rows per carton don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS ux_receiving_shipments_primary
  ON receiving_shipments(receiving_id)
  WHERE is_primary;

COMMENT ON TABLE receiving_shipments IS
  'PO↔shipment junction (multi-box per PO). One row per carton/tracking attached to a receiving carton; is_primary row mirrors receiving.shipment_id (the Zoho reference# anchor). docs/multi-tracking-po-plan.md Phase 1.';

-- Optional denominator for the "received X of N boxes" rollup chip. NULL =
-- open-ended ("N boxes received" with no denominator until the receiver sets it).
ALTER TABLE receiving
  ADD COLUMN IF NOT EXISTS expected_box_count INTEGER;

COMMENT ON COLUMN receiving.expected_box_count IS
  'Receiver-entered total carton count for a multi-box PO. Denominator for the boxes-received rollup; NULL = open-ended. docs/multi-tracking-po-plan.md.';

COMMIT;
