-- ============================================================================
-- 2026-06-25_receiving_line_coarse_status_trigger.sql
--
-- Receiving redesign Phase 2b (the safe form). Keep the coarse operator
-- lifecycle (receiving_lines.receiving_line_status) + the coarse-stage line
-- timestamps in lockstep with workflow_status on EVERY write — without touching
-- the hot raw-UPDATE write sites (receive-line, mark-received[-po], match,
-- lookup-po, zoho reconcile). A BEFORE trigger derives the column on any
-- workflow_status change, so the stored value is correct + DB-filterable
-- everywhere, matching the chokepoint (transitionReceivingLine) and the
-- read-time resolveReceivingLineStatus().
--
-- ⚠ SoT: the CASE below MIRRORS deriveReceivingLineStatus() in
-- src/lib/receiving/workflow-stages.ts — keep the two in lockstep. The TS fn
-- stays the canonical map (used for reads/derive-on-read); this trigger is the
-- write-time mirror so the column is never stale.
--
-- COALESCE stamps each coarse-stage timestamp only on first entry (idempotent;
-- agrees with the chokepoint). Backfills the column for existing rows (coarse
-- status only — timestamps are real events, not retro-stamped).
--
-- ADDITIVE + idempotent (CREATE OR REPLACE / DROP TRIGGER IF EXISTS). No
-- behavior change to workflow_status itself. ROLLBACK: DROP TRIGGER
-- trg_receiving_line_coarse_status ON receiving_lines; DROP FUNCTION
-- fn_receiving_line_coarse_status().
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_receiving_line_coarse_status() RETURNS trigger AS $$
BEGIN
  -- MIRROR of deriveReceivingLineStatus (workflow-stages.ts). PROBLEM is NOT a
  -- value here — it is the orthogonal exception_code dimension.
  NEW.receiving_line_status := CASE upper(NEW.workflow_status::text)
    WHEN 'EXPECTED' THEN 'INCOMING'
    WHEN 'ARRIVED'  THEN 'SCANNED'
    WHEN 'MATCHED'  THEN 'SCANNED'
    WHEN 'UNBOXED'  THEN 'UNBOXED'
    ELSE 'RECEIVED'  -- AWAITING_TEST | IN_TEST | PASSED | FAILED | RTV | SCRAP | DONE
  END;
  IF NEW.receiving_line_status = 'SCANNED'  THEN NEW.scanned_at  := COALESCE(NEW.scanned_at,  NOW()); END IF;
  IF NEW.receiving_line_status = 'UNBOXED'  THEN NEW.unboxed_at  := COALESCE(NEW.unboxed_at,  NOW()); END IF;
  IF NEW.receiving_line_status = 'RECEIVED' THEN NEW.received_at := COALESCE(NEW.received_at, NOW()); END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_receiving_line_coarse_status ON receiving_lines;
CREATE TRIGGER trg_receiving_line_coarse_status
  BEFORE INSERT OR UPDATE OF workflow_status ON receiving_lines
  FOR EACH ROW EXECUTE FUNCTION fn_receiving_line_coarse_status();

-- One-time backfill of the coarse status for existing rows (column only).
UPDATE receiving_lines
   SET receiving_line_status = CASE upper(workflow_status::text)
         WHEN 'EXPECTED' THEN 'INCOMING'
         WHEN 'ARRIVED'  THEN 'SCANNED'
         WHEN 'MATCHED'  THEN 'SCANNED'
         WHEN 'UNBOXED'  THEN 'UNBOXED'
         ELSE 'RECEIVED'
       END
 WHERE receiving_line_status IS NULL;
