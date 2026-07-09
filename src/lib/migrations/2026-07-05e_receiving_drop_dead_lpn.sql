-- ============================================================================
-- 2026-07-05e_receiving_drop_dead_lpn.sql
--
-- Receiving polymorphic refactor — first legacy-column drop (§7 Step F / §8 step 13:
-- "drop dead lpn"). `receiving.lpn` (now `receiving_carton.lpn`) was a dead
-- 'RC-<id>' text alias of the primary key — carton identity is the id itself and
-- `handling_unit_id`. Its only code touchpoints were a self-referential writer
-- (lookup-po `SET lpn = 'RC-'||id`) and one search-doc token; both removed in the
-- same change, so nothing reads it.
--
-- COMPAT-VIEW RECREATION PATTERN (reused for every future column drop):
-- `receiving` is a `SELECT *` compat view over `receiving_carton` (2026-07-05d).
-- A base-column drop invalidates a `SELECT *` view's stored column list, and
-- CREATE OR REPLACE VIEW cannot remove a column — so the view is DROPped, the
-- column dropped, then the view recreated (all inside one tx → the ACCESS
-- EXCLUSIVE lock makes it atomic to concurrent readers; no visible gap).
-- security_invoker=true is re-applied so tenant RLS keeps enforcing.
--
-- IDEMPOTENT: DROP VIEW IF EXISTS + DROP COLUMN IF EXISTS + CREATE VIEW.
-- ROLLBACK: ALTER TABLE receiving_carton ADD COLUMN lpn text; (view auto-carries
--   it on next recreate) — the data is not restorable but it was a pure id alias.
-- ============================================================================

BEGIN;

DROP VIEW IF EXISTS receiving;

-- Its stray unique index.
DROP INDEX IF EXISTS idx_receiving_lpn_uniq;

-- The entity-search-outbox UPDATE trigger watches lpn in its UPDATE OF / WHEN
-- (a hard column dependency), so recreate it WITHOUT lpn before the drop. Same
-- function; only the lpn column is removed from the watch list + WHEN predicate.
-- (Reference def: 2026-07-03d_entity_search_docs.sql.)
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_receiving_upd ON receiving_carton;
CREATE TRIGGER trg_enqueue_search_outbox_on_receiving_upd
  AFTER UPDATE OF carrier, source_platform, intake_type, exception_code,
    zoho_purchaseorder_number, support_notes, zoho_notes, condition_grade,
    qa_status, shipment_id, received_at, zendesk_ticket
  ON receiving_carton FOR EACH ROW
  WHEN (
    (old.carrier IS DISTINCT FROM new.carrier)
    OR (old.source_platform IS DISTINCT FROM new.source_platform)
    OR (old.intake_type IS DISTINCT FROM new.intake_type)
    OR (old.exception_code IS DISTINCT FROM new.exception_code)
    OR (old.zoho_purchaseorder_number IS DISTINCT FROM new.zoho_purchaseorder_number)
    OR (old.support_notes IS DISTINCT FROM new.support_notes)
    OR (old.zoho_notes IS DISTINCT FROM new.zoho_notes)
    OR (old.condition_grade IS DISTINCT FROM new.condition_grade)
    OR (old.qa_status IS DISTINCT FROM new.qa_status)
    OR (old.shipment_id IS DISTINCT FROM new.shipment_id)
    OR (old.received_at IS DISTINCT FROM new.received_at)
    OR (old.zendesk_ticket IS DISTINCT FROM new.zendesk_ticket)
  )
  EXECUTE FUNCTION fn_enqueue_entity_search_outbox('RECEIVING');

ALTER TABLE receiving_carton DROP COLUMN IF EXISTS lpn;

CREATE VIEW receiving
  WITH (security_invoker = true) AS
  SELECT * FROM receiving_carton;

COMMENT ON VIEW receiving IS
  'COMPAT SHIM (2026-07-05d): receiving was renamed to receiving_carton. Auto-updatable, security_invoker=true (RLS enforced per querying role). New code uses receiving_carton; this view keeps legacy raw SQL working until refs are migrated. ON CONFLICT must target receiving_carton.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON receiving TO app_tenant;
  END IF;
END $$;

COMMIT;
