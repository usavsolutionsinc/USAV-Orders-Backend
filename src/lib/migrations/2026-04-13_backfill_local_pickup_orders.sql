-- Backfill: migrate existing local_pickup_items into new local_pickup_orders schema.
-- Groups items by pickup_date into one order per date, status = COMPLETED (already logged).

-- Step 1: Create one order per distinct pickup_date
INSERT INTO local_pickup_orders (pickup_date, status, completed_at, created_at, updated_at)
SELECT DISTINCT
  COALESCE(
    lpi.pickup_date,
    (r.received_at AT TIME ZONE 'America/Los_Angeles')::date,
    (r.created_at AT TIME ZONE 'America/Los_Angeles')::date
  ) AS pickup_date,
  'COMPLETED',
  NOW(),
  MIN(COALESCE(r.received_at, r.created_at)),
  NOW()
FROM receiving r
LEFT JOIN local_pickup_items lpi ON lpi.receiving_id = r.id
WHERE (
  UPPER(COALESCE(r.carrier, '')) = 'LOCAL'
  OR UPPER(COALESCE(r.receiving_tracking_number, '')) LIKE 'LOCAL-%'
)
GROUP BY 1
ON CONFLICT DO NOTHING;

-- Step 2: Insert line items linked to the matching order by pickup_date
INSERT INTO local_pickup_order_items (
  order_id, receiving_id, sku, product_title, image_url, quantity,
  condition_grade, parts_status, missing_parts_note, condition_note, total_price,
  created_at, updated_at
)
SELECT
  lpo.id AS order_id,
  r.id AS receiving_id,
  COALESCE(lpi.sku, 'UNKNOWN'),
  COALESCE(lpi.product_title, r.receiving_tracking_number, 'Local Pickup'),
  NULL,
  COALESCE(lpi.quantity, 1),
  COALESCE(lpi.receiving_grade, r.condition_grade::text, 'USED_A'),
  COALESCE(lpi.parts_status, 'COMPLETE'),
  lpi.missing_parts_note,
  lpi.condition_note,
  COALESCE(
    lpi.total,
    COALESCE(lpi.offer_price, 0) * COALESCE(lpi.quantity, 1)
  )::numeric(12,2),
  COALESCE(r.received_at, r.created_at),
  NOW()
FROM receiving r
LEFT JOIN local_pickup_items lpi ON lpi.receiving_id = r.id
JOIN local_pickup_orders lpo ON lpo.pickup_date = COALESCE(
  lpi.pickup_date,
  (r.received_at AT TIME ZONE 'America/Los_Angeles')::date,
  (r.created_at AT TIME ZONE 'America/Los_Angeles')::date
)
WHERE (
  UPPER(COALESCE(r.carrier, '')) = 'LOCAL'
  OR UPPER(COALESCE(r.receiving_tracking_number, '')) LIKE 'LOCAL-%'
)
AND NOT EXISTS (
  SELECT 1 FROM local_pickup_order_items lpoi WHERE lpoi.receiving_id = r.id
);
