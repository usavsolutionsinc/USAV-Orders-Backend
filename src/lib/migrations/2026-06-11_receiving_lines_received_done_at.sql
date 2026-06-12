-- Dedicated "Received" timestamp for receiving lines.
--
-- Context: `receiving.received_at` is misleadingly named — it's stamped at the
-- DOOR SCAN (lookup-po), so it holds the arrival/scan time, NOT the moment a
-- line is actually received. In this lifecycle the "Received" state is the
-- terminal DONE step:
--   SCANNED (MATCHED) → UNBOXED → RECEIVED (DONE)
-- ...reached at full mark-received OR the Zoho-received reconcile. Until now no
-- column recorded WHEN a line hit DONE, so History had no clean axis to sort
-- "recently received" by. This adds one.
--
-- Idempotent — safe to re-run.

BEGIN;

ALTER TABLE receiving_lines
  ADD COLUMN IF NOT EXISTS received_done_at TIMESTAMPTZ;

-- Backfill existing DONE lines so the History "Received" sort isn't blank for
-- past data. `updated_at` is the closest historical proxy for when the line
-- settled into DONE (no better signal was recorded before this column), falling
-- back to created_at. New rows get the exact transition time via the trigger.
UPDATE receiving_lines
   SET received_done_at = COALESCE(received_done_at, updated_at, created_at)
 WHERE workflow_status = 'DONE'::inbound_workflow_status_enum
   AND received_done_at IS NULL;

-- Sort/index support for `ORDER BY received_done_at DESC` on the History feed.
CREATE INDEX IF NOT EXISTS idx_receiving_lines_received_done_at
  ON receiving_lines(received_done_at)
  WHERE received_done_at IS NOT NULL;

-- Stamp received_done_at the FIRST time a line reaches DONE. Centralized in a
-- trigger so every write path (mark-received, mark-received-po, the Zoho-received
-- reconcile, receive-line) gets it for free and can't drift out of sync. Only
-- stamps when still NULL, so a line that bounces out of and back into DONE keeps
-- its original receive time; an explicit caller-supplied value is also honored.
CREATE OR REPLACE FUNCTION fn_stamp_receiving_line_received_done_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workflow_status = 'DONE'::inbound_workflow_status_enum
     AND NEW.received_done_at IS NULL THEN
    NEW.received_done_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_receiving_lines_received_done_at ON receiving_lines;
CREATE TRIGGER trg_receiving_lines_received_done_at
  BEFORE INSERT OR UPDATE ON receiving_lines
  FOR EACH ROW EXECUTE FUNCTION fn_stamp_receiving_line_received_done_at();

COMMIT;
