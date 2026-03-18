-- Ensure repair_service has a JSONB status history column for station and repair workflow events.

ALTER TABLE repair_service
  ADD COLUMN IF NOT EXISTS status_history JSONB;

ALTER TABLE repair_service
  ALTER COLUMN status_history TYPE JSONB
  USING CASE
    WHEN status_history IS NULL THEN '[]'::jsonb
    ELSE status_history::jsonb
  END;

UPDATE repair_service
SET status_history = '[]'::jsonb
WHERE status_history IS NULL;

ALTER TABLE repair_service
  ALTER COLUMN status_history SET DEFAULT '[]'::jsonb;

ALTER TABLE repair_service
  ALTER COLUMN status_history SET NOT NULL;
