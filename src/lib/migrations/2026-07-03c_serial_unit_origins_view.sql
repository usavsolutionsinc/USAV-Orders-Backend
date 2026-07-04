-- ============================================================================
-- 2026-07-03c: v_serial_unit_origins — reconstruction view for Phase 3
-- ============================================================================
-- Phase 3 foundation of docs/todo/schema-wide-polymorphic-refactor-plan.md
-- ("Serial Units"). Rebuilds the serial_units.origin_* family from
-- serial_unit_provenance so readers can migrate OFF the base columns with a
-- single mechanical change (swap `su.origin_*` → a join on this view), and so
-- the reconstruction logic lives in ONE audited place instead of 20 bespoke
-- rewrites. Phase 4 then drops the base columns; readers already read the view.
--
-- security_invoker = true: the view must run with the QUERYING role's RLS, not
-- the view owner's — otherwise it would bypass tenant isolation on
-- serial_unit_provenance / serial_units. (Neon Postgres ≥ 15.)
--
-- Reconstruction (verified lossless for the three id columns against live data
-- 2026-07-03 — 0 mismatches; see 2026-07-03c parity check):
--   origin_receiving_line_id ← the RECEIVING_LINE edge's origin_id (exactly one
--        concrete edge per unit — origin_receiving_line_id is COALESCE-only, so
--        it is set at most once; MIN(occurred_at) picks it deterministically).
--   origin_tsn_id            ← the TECH_SERIAL edge's origin_id (same argument).
--   origin_sku_id            ← the SKU_IMPORT edge's origin_id (base column is
--        never populated in live data; both sides NULL → lossless).
--   origin_source            ← SEMANTIC map from the earliest edge's type, NOT
--        string-exact: the historical text 'legacy_tsn_backfill' (327 rows) and
--        any future free text is collapsed to its canonical source word. This is
--        a debug/admin display label only; defaultStatusForSource() reads the
--        write-INPUT, never this column, so status logic is unaffected. The one
--        behavioral delta: an admin "Origin" readout shows 'tsn' where it showed
--        'legacy_tsn_backfill'. Documented + accepted for Phase 3.
--
-- ADDITIVE + REVERSIBLE. No column/data changes.
-- ROLLBACK: DROP VIEW IF EXISTS v_serial_unit_origins;
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW v_serial_unit_origins
WITH (security_invoker = true) AS
SELECT
  su.id              AS serial_unit_id,
  su.organization_id AS organization_id,
  ( SELECT p.origin_id FROM serial_unit_provenance p
     WHERE p.serial_unit_id = su.id AND p.origin_type = 'RECEIVING_LINE' AND p.origin_id IS NOT NULL
     ORDER BY p.occurred_at ASC, p.id ASC LIMIT 1 )::int  AS origin_receiving_line_id,
  ( SELECT p.origin_id FROM serial_unit_provenance p
     WHERE p.serial_unit_id = su.id AND p.origin_type = 'TECH_SERIAL' AND p.origin_id IS NOT NULL
     ORDER BY p.occurred_at ASC, p.id ASC LIMIT 1 )::int  AS origin_tsn_id,
  ( SELECT p.origin_id FROM serial_unit_provenance p
     WHERE p.serial_unit_id = su.id AND p.origin_type = 'SKU_IMPORT' AND p.origin_id IS NOT NULL
     ORDER BY p.occurred_at ASC, p.id ASC LIMIT 1 )::int  AS origin_sku_id,
  ( SELECT CASE p.origin_type
             WHEN 'RECEIVING_LINE' THEN 'receiving'
             WHEN 'TECH_SERIAL'    THEN 'tsn'
             WHEN 'SKU_IMPORT'     THEN 'sku'
             WHEN 'MANUAL'         THEN 'manual'
             WHEN 'LEGACY'         THEN 'legacy'
             ELSE lower(p.origin_type)
           END
      FROM serial_unit_provenance p
     WHERE p.serial_unit_id = su.id
     ORDER BY p.occurred_at ASC, p.id ASC LIMIT 1 )        AS origin_source
FROM serial_units su;

COMMENT ON VIEW v_serial_unit_origins IS
  'Phase 3 reconstruction of serial_units.origin_* from serial_unit_provenance. security_invoker so tenant RLS is respected. id columns are lossless; origin_source is a semantic (not string-exact) display label. Readers migrate here before Phase 4 drops the base columns.';

COMMIT;
