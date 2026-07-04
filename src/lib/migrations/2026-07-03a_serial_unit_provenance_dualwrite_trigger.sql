-- ============================================================================
-- 2026-07-03a: serial_unit_provenance — Phase 2 dual-write (trigger-maintained)
-- ============================================================================
-- Phase 2 of docs/todo/schema-wide-polymorphic-refactor-plan.md ("Serial Units").
-- Phase 1 (2026-07-01n) created serial_unit_provenance and backfilled existing
-- rows. This migration makes it a LIVE projection: every future write to a
-- serial_units.origin_* column also maintains the provenance edge(s).
--
-- WHY A TRIGGER (not app-side dual-write): serial_units is INSERTed from three
-- code paths (upsertSerialUnit, receiving/mark-received, insertTechSerialForTracking)
-- and origin_* columns are also COALESCE-filled on later UPDATEs. A single
-- AFTER INSERT OR UPDATE trigger covers ALL of them with zero missed sites, and
-- matches the repo's existing trigger-maintained-projection pattern (sku_stock
-- from sku_stock_ledger). When Phase 4 drops the origin_* columns, this trigger
-- is dropped and writes move app-side (the provenance INSERT moves into the
-- domain helpers) — see the Phase 4 migration's header.
--
-- The mapping mirrors 2026-07-01n's backfill EXACTLY (so the trigger and the
-- backfill can never disagree):
--   origin_receiving_line_id  -> ('RECEIVING_LINE', id)   -- independent edges;
--   origin_tsn_id             -> ('TECH_SERIAL',    id)   --   a unit can carry
--   origin_sku_id             -> ('SKU_IMPORT',     id)   --   more than one
--   else origin_source text   -> mapped type, origin_id NULL (only when NO
--                                concrete id exists on the row)
--   occurred_at = COALESCE(received_at, created_at, now())
--
-- Idempotent: every INSERT is ON CONFLICT DO NOTHING against the natural /
-- text-only uniques, so re-firing on UPDATE (or a re-run) is a no-op. The
-- trigger only ADDS provenance edges — it never deletes them (origin_* columns
-- are COALESCE-only / append-in-spirit, so an edge, once true, stays true).
--
-- Also re-runs the backfill under ON CONFLICT DO NOTHING to sweep any rows
-- created between 2026-07-01n and this migration (belt-and-suspenders; harmless
-- if 2026-07-01n already covered them).
--
-- ADDITIVE + REVERSIBLE. No column changes. Readers still read origin_*.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_sync_serial_unit_provenance ON serial_units;
--   DROP FUNCTION IF EXISTS fn_sync_serial_unit_provenance();
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_sync_serial_unit_provenance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  occurred TIMESTAMPTZ := COALESCE(NEW.received_at, NEW.created_at, now());
BEGIN
  -- Concrete-id edges (each independent; a unit can have more than one).
  IF NEW.origin_receiving_line_id IS NOT NULL THEN
    INSERT INTO serial_unit_provenance
      (organization_id, serial_unit_id, origin_type, origin_id, occurred_at)
    VALUES
      (NEW.organization_id, NEW.id, 'RECEIVING_LINE', NEW.origin_receiving_line_id::bigint, occurred)
    ON CONFLICT DO NOTHING;
  END IF;

  IF NEW.origin_tsn_id IS NOT NULL THEN
    INSERT INTO serial_unit_provenance
      (organization_id, serial_unit_id, origin_type, origin_id, occurred_at)
    VALUES
      (NEW.organization_id, NEW.id, 'TECH_SERIAL', NEW.origin_tsn_id::bigint, occurred)
    ON CONFLICT DO NOTHING;
  END IF;

  IF NEW.origin_sku_id IS NOT NULL THEN
    INSERT INTO serial_unit_provenance
      (organization_id, serial_unit_id, origin_type, origin_id, occurred_at)
    VALUES
      (NEW.organization_id, NEW.id, 'SKU_IMPORT', NEW.origin_sku_id::bigint, occurred)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Text-only fallback: only when NO concrete id exists on the row.
  IF NEW.origin_receiving_line_id IS NULL
     AND NEW.origin_tsn_id IS NULL
     AND NEW.origin_sku_id IS NULL
     AND NEW.origin_source IN ('receiving','tsn','sku','manual','legacy') THEN
    INSERT INTO serial_unit_provenance
      (organization_id, serial_unit_id, origin_type, origin_id, occurred_at)
    VALUES
      (NEW.organization_id, NEW.id,
       CASE NEW.origin_source
         WHEN 'receiving' THEN 'RECEIVING_LINE'
         WHEN 'tsn'       THEN 'TECH_SERIAL'
         WHEN 'sku'       THEN 'SKU_IMPORT'
         WHEN 'manual'    THEN 'MANUAL'
         WHEN 'legacy'    THEN 'LEGACY'
       END,
       NULL::bigint, occurred)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_serial_unit_provenance ON serial_units;
CREATE TRIGGER trg_sync_serial_unit_provenance
  AFTER INSERT OR UPDATE OF origin_source, origin_receiving_line_id, origin_tsn_id, origin_sku_id
  ON serial_units
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_serial_unit_provenance();

COMMENT ON FUNCTION fn_sync_serial_unit_provenance() IS
  'Phase 2 dual-write: maintains serial_unit_provenance from serial_units.origin_* on every INSERT/UPDATE. Mirrors 2026-07-01n backfill mapping. Dropped in Phase 4 when origin_* columns are removed and writes move app-side.';

-- Belt-and-suspenders sweep for rows written between 2026-07-01n and now.
INSERT INTO serial_unit_provenance (organization_id, serial_unit_id, origin_type, origin_id, occurred_at)
SELECT su.organization_id, su.id, 'RECEIVING_LINE', su.origin_receiving_line_id::bigint,
       COALESCE(su.received_at, su.created_at)
  FROM serial_units su WHERE su.origin_receiving_line_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO serial_unit_provenance (organization_id, serial_unit_id, origin_type, origin_id, occurred_at)
SELECT su.organization_id, su.id, 'TECH_SERIAL', su.origin_tsn_id::bigint,
       COALESCE(su.received_at, su.created_at)
  FROM serial_units su WHERE su.origin_tsn_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO serial_unit_provenance (organization_id, serial_unit_id, origin_type, origin_id, occurred_at)
SELECT su.organization_id, su.id, 'SKU_IMPORT', su.origin_sku_id::bigint,
       COALESCE(su.received_at, su.created_at)
  FROM serial_units su WHERE su.origin_sku_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO serial_unit_provenance (organization_id, serial_unit_id, origin_type, origin_id, occurred_at)
SELECT su.organization_id, su.id,
       CASE su.origin_source
         WHEN 'receiving' THEN 'RECEIVING_LINE'
         WHEN 'tsn'       THEN 'TECH_SERIAL'
         WHEN 'sku'       THEN 'SKU_IMPORT'
         WHEN 'manual'    THEN 'MANUAL'
         WHEN 'legacy'    THEN 'LEGACY'
       END,
       NULL::bigint, COALESCE(su.received_at, su.created_at)
  FROM serial_units su
 WHERE su.origin_receiving_line_id IS NULL
   AND su.origin_tsn_id IS NULL
   AND su.origin_sku_id IS NULL
   AND su.origin_source IN ('receiving','tsn','sku','manual','legacy')
ON CONFLICT DO NOTHING;

COMMIT;
