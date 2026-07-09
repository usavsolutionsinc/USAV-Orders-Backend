-- ============================================================================
-- 2026-07-05c_receiving_street_tables.sql
--
-- Receiving polymorphic refactor — carton-grain street side-tables (step 3b).
-- Plan: docs/todo/polymorphic-tables-database-refactor-plan.md §4.2(a) + §8 step 3b.
--
-- Triage (door / classify / stage / save-for-unbox) and Unbox (bench open /
-- unboxed milestone) are INDEPENDENT operator streets on ONE carton. Today their
-- state is multiplexed onto the wide `receiving` spine as denorm columns added by
-- three interim migrations:
--   2026-06-30_receiving_unbox_opened_at.sql   → unbox_opened_at / unbox_opened_by
--   2026-07-01b_receiving_triage_columns.sql   → staging_location_id, priority_lane,
--                                                 pairing_state, triage_complete(+_at/_by)
--   2026-07-05_receiving_independent_mode_scans → unbox_only_intake (+ line.condition_set_at)
-- …plus the pre-existing received_at/received_by and unboxed_at/unboxed_by.
--
-- This migration lands the two carton 1:1 street tables the plan specifies as the
-- destination for those columns, and keeps them LIVE via a dual-write trigger on
-- `receiving` (the same strangler mechanism 2026-06-29e used for the line facts —
-- ONE place, touches none of the mid-WIP receiving write paths, cannot conflict
-- with in-flight app changes). The interim spine columns remain the read source
-- until the per-street reader cutover (§8 step 3b tail); these tables are their
-- validated shadow (parity-checkable before the eventual column drop).
--
--   receiving_triage  — door received, staging, pairing, save-for-unbox (1:1 carton)
--   receiving_unbox   — bench opened, unboxed milestone, intake_path (1:1 carton)
--
-- Also: promote condition_set_at to receiving_line_testing (its target home per
-- plan §10) and extend the 2026-06-29e line-facts dual-write trigger to mirror it,
-- so `receiving_lines.condition_set_at` and `receiving_line_testing.condition_set_at`
-- stay in parity too.
--
-- FK grain: `receiving.id` is INTEGER (serial) today (rename to receiving_carton
-- is the final destructive step, §8 step 14), so these reference receiving(id).
--
-- TENANT: organization_id NOT NULL with the GUC loud-fail-able default; every key
-- leads with organization_id.
--
-- ⚠ RLS ARMED, NOT FORCED — matches the 2026-06-29c / receiving_exceptions
-- precedent. The one-time backfill below runs as the migration owner (neondb_owner,
-- BYPASSRLS) with NO app.current_org GUC set, so FORCE would reject it (WITH CHECK
-- org = NULL). The dual-write trigger likewise fires in whatever session wrote
-- `receiving` (owner for the raw-pool scan writers; app_tenant for the tenant-tx
-- writers) — ENABLE (not FORCE) enforces under app_tenant and is inert under the
-- owner, which is exactly what we want. These join the FORCE set in a later
-- enforce wave alongside the other receiving_line_* facts tables.
--
-- ADDITIVE + IDEMPOTENT: CREATE … IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, DROP/CREATE TRIGGER, INSERT … ON CONFLICT. Re-running
-- is a no-op. No column is dropped from receiving / receiving_lines here.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_sync_receiving_street ON receiving;
--   DROP FUNCTION IF EXISTS fn_sync_receiving_street();
--   DROP TABLE IF EXISTS receiving_unbox, receiving_triage;
--   -- (condition_set_at on receiving_line_testing + the extended line-facts
--   --  trigger are additive; leave or revert 2026-06-29e's function/trigger.)
-- VERIFY: UPDATE receiving.triage_complete in a tx → receiving_triage reflects it.
-- ============================================================================

BEGIN;

-- ── receiving_triage (carton-grain triage street ops) ───────────────────────
CREATE TABLE IF NOT EXISTS receiving_triage (
  receiving_id         integer PRIMARY KEY REFERENCES receiving(id) ON DELETE CASCADE,
  organization_id      uuid NOT NULL
                         DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  door_received_at     timestamptz,                 -- mirror of receiving.received_at (first triage door scan)
  door_received_by     integer REFERENCES staff(id) ON DELETE SET NULL,
  staging_location_id  integer REFERENCES locations(id),
  priority_lane        text,
  pairing_state        text,
  triage_complete      boolean NOT NULL DEFAULT false,
  triage_completed_at  timestamptz,
  triage_completed_by  integer REFERENCES staff(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receiving_triage_pairing_state_chk
    CHECK (pairing_state IS NULL OR pairing_state IN ('UNFOUND', 'MATCHED', 'WAIVED'))
);

-- Done tab reads WHERE triage_complete — partial index keeps that scan cheap.
CREATE INDEX IF NOT EXISTS idx_receiving_triage_org_complete
  ON receiving_triage (organization_id, triage_completed_at DESC)
  WHERE triage_complete;
CREATE INDEX IF NOT EXISTS idx_receiving_triage_staging
  ON receiving_triage (staging_location_id)
  WHERE staging_location_id IS NOT NULL;

COMMENT ON TABLE receiving_triage IS
  'Carton-grain TRIAGE street ops (door received, staging, pairing, save-for-unbox), 1:1 with receiving. Interim shadow of the receiving.* triage columns; kept live by trg_sync_receiving_street. Receiving polymorphic refactor §4.2(a).';

-- ── receiving_unbox (carton-grain unbox street ops) ─────────────────────────
CREATE TABLE IF NOT EXISTS receiving_unbox (
  receiving_id   integer PRIMARY KEY REFERENCES receiving(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL
                    DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  opened_at      timestamptz,                       -- mirror of receiving.unbox_opened_at (bench queue entry)
  opened_by      integer REFERENCES staff(id) ON DELETE SET NULL,
  unboxed_at     timestamptz,                       -- operator "Unboxed" action (NOT scan-owned)
  unboxed_by     integer REFERENCES staff(id) ON DELETE SET NULL,
  intake_path    text NOT NULL DEFAULT 'unknown'
                   CHECK (intake_path IN ('triage_first', 'unbox_only', 'unknown')),
  -- triage_first = door scan preceded bench; unbox_only = bench-first (no door_received_at)
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receiving_unbox_intake_path
  ON receiving_unbox (organization_id, intake_path)
  WHERE intake_path = 'unbox_only';

COMMENT ON TABLE receiving_unbox IS
  'Carton-grain UNBOX street ops (bench opened, unboxed milestone, intake_path), 1:1 with receiving. Interim shadow of the receiving.unbox_*/unboxed_* columns; kept live by trg_sync_receiving_street. Receiving polymorphic refactor §4.2(a).';

-- ── condition_set_at → receiving_line_testing (its target home, plan §10) ────
ALTER TABLE receiving_line_testing
  ADD COLUMN IF NOT EXISTS condition_set_at timestamptz;

COMMENT ON COLUMN receiving_line_testing.condition_set_at IS
  'When the operator explicitly selected condition_grade (distinct from the DB default). Moved here from receiving_lines.condition_set_at (plan §10).';

-- ── One-time backfill (owner-run, org-explicit; ON CONFLICT re-runnable) ─────
INSERT INTO receiving_triage (
  receiving_id, organization_id, door_received_at, door_received_by,
  staging_location_id, priority_lane, pairing_state,
  triage_complete, triage_completed_at, triage_completed_by)
SELECT r.id, r.organization_id, r.received_at, r.received_by,
       r.staging_location_id, r.priority_lane, r.pairing_state,
       r.triage_complete, r.triage_completed_at, r.triage_completed_by
  FROM receiving r
 WHERE r.received_at IS NOT NULL
    OR r.staging_location_id IS NOT NULL
    OR r.priority_lane IS NOT NULL
    OR r.triage_complete
ON CONFLICT (receiving_id) DO UPDATE SET
  door_received_at    = EXCLUDED.door_received_at,
  door_received_by    = EXCLUDED.door_received_by,
  staging_location_id = EXCLUDED.staging_location_id,
  priority_lane       = EXCLUDED.priority_lane,
  pairing_state       = EXCLUDED.pairing_state,
  triage_complete     = EXCLUDED.triage_complete,
  triage_completed_at = EXCLUDED.triage_completed_at,
  triage_completed_by = EXCLUDED.triage_completed_by,
  updated_at          = now();

INSERT INTO receiving_unbox (
  receiving_id, organization_id, opened_at, opened_by, unboxed_at, unboxed_by, intake_path)
SELECT r.id, r.organization_id, r.unbox_opened_at, r.unbox_opened_by, r.unboxed_at, r.unboxed_by,
       CASE WHEN r.unbox_only_intake THEN 'unbox_only'
            WHEN r.received_at IS NOT NULL THEN 'triage_first'
            ELSE 'unknown' END
  FROM receiving r
 WHERE r.unbox_opened_at IS NOT NULL
    OR r.unboxed_at IS NOT NULL
    OR r.unbox_only_intake
ON CONFLICT (receiving_id) DO UPDATE SET
  opened_at   = EXCLUDED.opened_at,
  opened_by   = EXCLUDED.opened_by,
  unboxed_at  = EXCLUDED.unboxed_at,
  unboxed_by  = EXCLUDED.unboxed_by,
  intake_path = EXCLUDED.intake_path,
  updated_at  = now();

UPDATE receiving_line_testing t
   SET condition_set_at = rl.condition_set_at, updated_at = now()
  FROM receiving_lines rl
 WHERE rl.id = t.receiving_line_id
   AND rl.condition_set_at IS NOT NULL
   AND t.condition_set_at IS DISTINCT FROM rl.condition_set_at;

-- ── Dual-write trigger: receiving.* triage/unbox cols → street tables ────────
-- Same shape + safety as 2026-06-29e's fn_sync_receiving_line_facts: AFTER-row,
-- fires only when a mirrored column changes, whole body swallowed on error so a
-- receiving write can never abort on a sync failure. The street row mirrors the
-- spine row verbatim (EXCLUDED = the committed NEW value = the spine truth).
CREATE OR REPLACE FUNCTION fn_sync_receiving_street() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    -- ── triage street ────────────────────────────────────────────────────
    IF NEW.received_at IS NOT NULL
       OR NEW.staging_location_id IS NOT NULL
       OR NEW.priority_lane IS NOT NULL
       OR NEW.triage_complete THEN
      INSERT INTO receiving_triage (
        receiving_id, organization_id, door_received_at, door_received_by,
        staging_location_id, priority_lane, pairing_state,
        triage_complete, triage_completed_at, triage_completed_by)
      VALUES (
        NEW.id, NEW.organization_id, NEW.received_at, NEW.received_by,
        NEW.staging_location_id, NEW.priority_lane, NEW.pairing_state,
        NEW.triage_complete, NEW.triage_completed_at, NEW.triage_completed_by)
      ON CONFLICT (receiving_id) DO UPDATE SET
        door_received_at    = EXCLUDED.door_received_at,
        door_received_by    = EXCLUDED.door_received_by,
        staging_location_id = EXCLUDED.staging_location_id,
        priority_lane       = EXCLUDED.priority_lane,
        pairing_state       = EXCLUDED.pairing_state,
        triage_complete     = EXCLUDED.triage_complete,
        triage_completed_at = EXCLUDED.triage_completed_at,
        triage_completed_by = EXCLUDED.triage_completed_by,
        updated_at          = now();
    END IF;

    -- ── unbox street ─────────────────────────────────────────────────────
    IF NEW.unbox_opened_at IS NOT NULL
       OR NEW.unboxed_at IS NOT NULL
       OR NEW.unbox_only_intake THEN
      INSERT INTO receiving_unbox (
        receiving_id, organization_id, opened_at, opened_by,
        unboxed_at, unboxed_by, intake_path)
      VALUES (
        NEW.id, NEW.organization_id, NEW.unbox_opened_at, NEW.unbox_opened_by,
        NEW.unboxed_at, NEW.unboxed_by,
        CASE WHEN NEW.unbox_only_intake THEN 'unbox_only'
             WHEN NEW.received_at IS NOT NULL THEN 'triage_first'
             ELSE 'unknown' END)
      ON CONFLICT (receiving_id) DO UPDATE SET
        opened_at   = EXCLUDED.opened_at,
        opened_by   = EXCLUDED.opened_by,
        unboxed_at  = EXCLUDED.unboxed_at,
        unboxed_by  = EXCLUDED.unboxed_by,
        intake_path = EXCLUDED.intake_path,
        updated_at  = now();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- dual-write is best-effort; never break the parent receiving write
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_receiving_street ON receiving;
CREATE TRIGGER trg_sync_receiving_street
  AFTER INSERT OR UPDATE OF
    received_at, received_by, staging_location_id, priority_lane, pairing_state,
    triage_complete, triage_completed_at, triage_completed_by,
    unbox_opened_at, unbox_opened_by, unboxed_at, unboxed_by, unbox_only_intake
  ON receiving
  FOR EACH ROW EXECUTE FUNCTION fn_sync_receiving_street();

COMMENT ON FUNCTION fn_sync_receiving_street() IS
  'Dual-write: mirrors receiving.* triage/unbox columns into receiving_triage/receiving_unbox. Best-effort (exception-guarded), AFTER-row. Receiving polymorphic refactor step 3b. Removed after the street reader cutover + column drop.';

-- ── Extend the 2026-06-29e line-facts trigger to also mirror condition_set_at ─
-- CREATE OR REPLACE re-publishes the whole function; the only change vs 29e is
-- the two condition_set_at lines in the testing upsert. Keeping the function name
-- means the trigger below just adds condition_set_at to its UPDATE OF list.
CREATE OR REPLACE FUNCTION fn_sync_receiving_line_facts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    -- ── testing facts (universal: every line carries qa/disposition routing) ──
    INSERT INTO receiving_line_testing (
      receiving_line_id, organization_id, needs_test, assigned_tech_id,
      qa_status, disposition_code, condition_grade, disposition_final,
      disposition_audit, condition_set_at)
    VALUES (
      NEW.id, NEW.organization_id, NEW.needs_test, NEW.assigned_tech_id,
      NEW.qa_status, NEW.disposition_code, NEW.condition_grade, NEW.disposition_final,
      COALESCE(NEW.disposition_audit, '[]'::jsonb), NEW.condition_set_at)
    ON CONFLICT (receiving_line_id) DO UPDATE SET
      needs_test        = EXCLUDED.needs_test,
      assigned_tech_id  = EXCLUDED.assigned_tech_id,
      qa_status         = EXCLUDED.qa_status,
      disposition_code  = EXCLUDED.disposition_code,
      condition_grade   = EXCLUDED.condition_grade,
      disposition_final = EXCLUDED.disposition_final,
      disposition_audit = EXCLUDED.disposition_audit,
      condition_set_at  = EXCLUDED.condition_set_at,
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

DROP TRIGGER IF EXISTS trg_sync_receiving_line_facts ON receiving_lines;
CREATE TRIGGER trg_sync_receiving_line_facts
  AFTER INSERT OR UPDATE OF
    needs_test, assigned_tech_id, qa_status, disposition_code, condition_grade,
    disposition_final, disposition_audit, condition_set_at,
    zoho_item_id, zoho_line_item_id,
    zoho_purchase_receive_id, zoho_purchaseorder_id, zoho_purchaseorder_number,
    zoho_sync_source, zoho_last_modified_time, zoho_synced_at, zoho_notes,
    unit_price, location_code
  ON receiving_lines
  FOR EACH ROW EXECUTE FUNCTION fn_sync_receiving_line_facts();

-- ── Arm RLS (ENABLE + policy; NOT forced — see header) ──────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['receiving_triage','receiving_unbox'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      $f$CREATE POLICY %I ON %I USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)$f$,
      t || '_tenant_isolation', t);
  END LOOP;
END $$;

-- ── Explicit runtime-role grants (belt-and-suspenders; ALTER DEFAULT
--    PRIVILEGES already covers owner-created tables — see
--    2026-06-28_app_tenant_grants_reaffirm.sql). Guarded on the role existing. ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON receiving_triage TO app_tenant;
    GRANT SELECT, INSERT, UPDATE, DELETE ON receiving_unbox  TO app_tenant;
  END IF;
END $$;

COMMIT;
