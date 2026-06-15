-- Phase 5 — denormalized governing-event timestamps on orders.
--
-- audit_logs remains the system of record (orders.tracking.added /
-- orders.label.printed events); these columns are a fast READ PROJECTION for the
-- Unshipped-page row chips (TRK✓ / LABEL✓) and `?sort` axes, so the list doesn't
-- query the audit trail per row. Stamped FIRST-TIME-ONLY (COALESCE / WHERE … IS
-- NULL) by the assign + order-labels routes; corrections still show in the full
-- timeline. Additive + idempotent — safe to run anytime.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS tracking_added_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tracking_added_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS label_printed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS label_printed_by  INTEGER REFERENCES staff(id) ON DELETE SET NULL;

-- Backfill tracking_added_at for already-tracked orders from the earliest audit
-- row, else the shipment row's created_at, so existing orders aren't blank.
UPDATE orders o
   SET tracking_added_at = sub.first_at
  FROM (
    SELECT o2.id,
           COALESCE(
             (SELECT MIN(al.created_at) FROM audit_logs al
               WHERE lower(al.entity_type) = 'order' AND al.entity_id = o2.id::text
                 AND al.action = 'orders.tracking.added'),
             (SELECT stn.created_at FROM shipping_tracking_numbers stn WHERE stn.id = o2.shipment_id)
           ) AS first_at
      FROM orders o2
     WHERE o2.shipment_id IS NOT NULL
  ) sub
 WHERE o.id = sub.id
   AND o.tracking_added_at IS NULL
   AND sub.first_at IS NOT NULL;
