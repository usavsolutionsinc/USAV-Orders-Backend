-- ============================================================================
-- 2026-06-29e_receiving_facts_dualwrite_trigger.sql
--
-- Receiving polymorphic refactor — Layer 2 DUAL-WRITE (strangler phase 2).
-- Plan: docs/todo/polymorphic-tables-database-refactor-plan.md §7.
--
-- The 2026-06-29d backfill snapshotted the wide receiving_lines columns into the
-- typed facts tables. This trigger keeps them LIVE: every write to a facts-
-- relevant column on receiving_lines is mirrored into receiving_line_testing /
-- _zoho / _putaway. That is the prerequisite for the reader cutover (readers can
-- only switch to the facts tables once they never go stale).
--
-- WHY A TRIGGER (not app-level dual-write): it's ONE place, touches none of the
-- ~5 receiving write paths (several of which are mid-WIP), and so cannot conflict
-- with in-flight app changes.
--
-- BULLETPROOF: the whole sync body is wrapped in BEGIN/EXCEPTION WHEN OTHERS THEN
-- NULL, so a sync failure is swallowed and the parent INSERT/UPDATE on
-- receiving_lines ALWAYS succeeds. Dual-write is best-effort; the backfill is the
-- baseline and a future resync reconciles any swallowed gap. AFTER-row trigger →
-- never delays the row write.
--
-- SCOPED: fires on INSERT, and on UPDATE only when a facts column actually
-- changes (UPDATE OF <cols>), so the common workflow_status-only transition write
-- does NOT pay for a sync.
--
-- ORG: organization_id is taken from NEW (the line's tenant). RLS on the facts
-- tables is armed-not-forced and the trigger runs as table owner, so the writes
-- land regardless.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_sync_receiving_line_facts ON receiving_lines;
--   DROP FUNCTION IF EXISTS fn_sync_receiving_line_facts();
-- VERIFY: UPDATE a line's disposition_final in a tx; the matching
--   receiving_line_testing row reflects it; ROLLBACK.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_sync_receiving_line_facts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Best-effort: any error here is swallowed so the parent write never aborts.
  BEGIN
    -- ── testing facts (universal: every line carries qa/disposition routing) ──
    INSERT INTO receiving_line_testing (
      receiving_line_id, organization_id, needs_test, assigned_tech_id,
      qa_status, disposition_code, condition_grade, disposition_final, disposition_audit)
    VALUES (
      NEW.id, NEW.organization_id, NEW.needs_test, NEW.assigned_tech_id,
      NEW.qa_status, NEW.disposition_code, NEW.condition_grade, NEW.disposition_final,
      COALESCE(NEW.disposition_audit, '[]'::jsonb))
    ON CONFLICT (receiving_line_id) DO UPDATE SET
      needs_test        = EXCLUDED.needs_test,
      assigned_tech_id  = EXCLUDED.assigned_tech_id,
      qa_status         = EXCLUDED.qa_status,
      disposition_code  = EXCLUDED.disposition_code,
      condition_grade   = EXCLUDED.condition_grade,
      disposition_final = EXCLUDED.disposition_final,
      disposition_audit = EXCLUDED.disposition_audit,
      updated_at        = now();

    -- ── zoho facts (only Zoho-origin lines) ─────────────────────────────────
    IF NEW.zoho_purchaseorder_id IS NOT NULL
       OR NEW.zoho_purchase_receive_id IS NOT NULL
       OR NEW.unit_price IS NOT NULL
       OR NEW.zoho_notes IS NOT NULL THEN
      INSERT INTO receiving_line_zoho (
        receiving_line_id, organization_id, zoho_item_id, zoho_line_item_id,
        zoho_purchase_receive_id, zoho_purchaseorder_id, zoho_purchaseorder_number,
        zoho_sync_source, zoho_last_modified_time, zoho_synced_at, zoho_notes, unit_price)
      VALUES (
        NEW.id, NEW.organization_id, NEW.zoho_item_id, NEW.zoho_line_item_id,
        NEW.zoho_purchase_receive_id, NEW.zoho_purchaseorder_id, NEW.zoho_purchaseorder_number,
        NEW.zoho_sync_source, NEW.zoho_last_modified_time, NEW.zoho_synced_at, NEW.zoho_notes, NEW.unit_price)
      ON CONFLICT (receiving_line_id) DO UPDATE SET
        zoho_item_id             = EXCLUDED.zoho_item_id,
        zoho_line_item_id        = EXCLUDED.zoho_line_item_id,
        zoho_purchase_receive_id = EXCLUDED.zoho_purchase_receive_id,
        zoho_purchaseorder_id    = EXCLUDED.zoho_purchaseorder_id,
        zoho_purchaseorder_number = EXCLUDED.zoho_purchaseorder_number,
        zoho_sync_source         = EXCLUDED.zoho_sync_source,
        zoho_last_modified_time  = EXCLUDED.zoho_last_modified_time,
        zoho_synced_at           = EXCLUDED.zoho_synced_at,
        zoho_notes               = EXCLUDED.zoho_notes,
        unit_price               = EXCLUDED.unit_price,
        updated_at               = now();
    END IF;

    -- ── putaway facts (only when a bin is set) ──────────────────────────────
    IF NEW.location_code IS NOT NULL THEN
      INSERT INTO receiving_line_putaway (receiving_line_id, organization_id, location_code)
      VALUES (NEW.id, NEW.organization_id, NEW.location_code)
      ON CONFLICT (receiving_line_id) DO UPDATE SET
        location_code = EXCLUDED.location_code,
        updated_at    = now();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- dual-write is best-effort; never break the parent receiving write
  END;
  RETURN NEW;
END;
$$;

-- Fire on INSERT, and on UPDATE only when a mirrored column changes (so a
-- workflow_status-only transition write doesn't trigger a sync).
DROP TRIGGER IF EXISTS trg_sync_receiving_line_facts ON receiving_lines;
CREATE TRIGGER trg_sync_receiving_line_facts
  AFTER INSERT OR UPDATE OF
    needs_test, assigned_tech_id, qa_status, disposition_code, condition_grade,
    disposition_final, disposition_audit, zoho_item_id, zoho_line_item_id,
    zoho_purchase_receive_id, zoho_purchaseorder_id, zoho_purchaseorder_number,
    zoho_sync_source, zoho_last_modified_time, zoho_synced_at, zoho_notes,
    unit_price, location_code
  ON receiving_lines
  FOR EACH ROW EXECUTE FUNCTION fn_sync_receiving_line_facts();

COMMENT ON FUNCTION fn_sync_receiving_line_facts() IS
  'Dual-write: mirrors receiving_lines facts columns into receiving_line_testing/_zoho/_putaway. Best-effort (exception-guarded), AFTER-row. Receiving polymorphic refactor strangler phase 2. Removed after the reader cutover + column drop.';

COMMIT;
