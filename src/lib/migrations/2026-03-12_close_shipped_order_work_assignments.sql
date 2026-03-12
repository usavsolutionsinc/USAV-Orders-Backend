-- Close active ORDER work_assignments for orders already shipped.
--
-- Why:
-- Shipped state is derived from shipping_tracking_numbers. Historical ORDER
-- TEST/PACK assignments can remain OPEN / ASSIGNED / IN_PROGRESS after the
-- carrier marks the shipment in transit / delivered, which leaves stale rows
-- hanging around in work-order style views.
--
-- Scope:
-- Mark active ORDER assignments DONE when the linked shipment is already in a
-- shipped carrier state.

UPDATE work_assignments wa
SET
  status = 'DONE',
  completed_at = COALESCE(wa.completed_at, NOW()),
  updated_at = NOW()
FROM orders o
JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
WHERE wa.entity_type = 'ORDER'
  AND wa.entity_id = o.id
  AND wa.work_type IN ('TEST', 'PACK')
  AND wa.status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
  AND (
    COALESCE(stn.is_carrier_accepted, false)
    OR COALESCE(stn.is_in_transit, false)
    OR COALESCE(stn.is_out_for_delivery, false)
    OR COALESCE(stn.is_delivered, false)
  );
