-- Repair pickup audit: capture who completed the pickup and when the
-- customer signed. Status changes already land in repair_service.status_history
-- as JSONB, but dedicated columns are needed for indexable reporting
-- ("show me all pickups this week", "pickups handled by tech X").

ALTER TABLE repair_service
  ADD COLUMN IF NOT EXISTS pickup_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_staff_id  INTEGER REFERENCES staff(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_repair_service_pickup_staff_id
  ON repair_service (pickup_staff_id)
  WHERE pickup_staff_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_repair_service_pickup_signed_at
  ON repair_service (pickup_signed_at DESC)
  WHERE pickup_signed_at IS NOT NULL;
