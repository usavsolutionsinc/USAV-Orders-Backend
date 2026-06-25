-- ============================================================================
-- 2026-06-24_receiving_lines_lifecycle_columns.sql
--
-- Receiving redesign Phase 0 (plan: iterative-hopping-dragon). Add the
-- line-level lifecycle facts the redesign needs, ADDITIVELY. All columns are
-- NULLABLE with NO volatile default → metadata-only ADD COLUMN (no table
-- rewrite) even on the hot receiving_lines table.
--
--   unit_price            — read-only mirror of the Zoho PO line.rate (unit cost),
--                           filled by zoho-receiving-sync (Phase 1). numeric(12,2)
--                           matches orders.sale_amount. Zoho stays SoR.
--   received_by           — line-level receiver (today only carton receiving.received_by).
--   scanned_at/unboxed_at/received_at — line-level lifecycle timestamps (today
--                           only on the carton); dual-written in Phase 1/2.
--   exception_code        — per-line exception (today only carton-level
--                           receiving.exception_code) — fixes the multi-line
--                           carton attribution loss.
--   receiving_line_status — coarse operator lifecycle INCOMING|SCANNED|UNBOXED|
--                           RECEIVED projected from workflow_status (one derive-SoT);
--                           PROBLEM is an orthogonal exception dimension
--                           (exception_code), never a value here. NULLABLE TEXT,
--                           NO enum/CHECK yet (the enum cutover is a later migration).
--
-- SAFETY: purely additive + nullable + no default + no behavior change — nothing
-- reads these until Phase 1 code lands. receiving_lines is org-scoped + FORCEd
-- already (2026-06-19); these columns inherit the row's tenant.
-- ROLLBACK: ALTER TABLE receiving_lines DROP COLUMN IF EXISTS <col>; (×7).
-- VERIFY: \d receiving_lines shows the 7 new columns, all nullable.
-- ============================================================================

ALTER TABLE receiving_lines
  ADD COLUMN IF NOT EXISTS unit_price            numeric(12,2),
  ADD COLUMN IF NOT EXISTS received_by           integer REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scanned_at            timestamptz,
  ADD COLUMN IF NOT EXISTS unboxed_at            timestamptz,
  ADD COLUMN IF NOT EXISTS received_at           timestamptz,
  ADD COLUMN IF NOT EXISTS exception_code        text,
  ADD COLUMN IF NOT EXISTS receiving_line_status text;

COMMENT ON COLUMN receiving_lines.unit_price IS
  'Read-only mirror of Zoho PO line.rate (unit cost); filled by zoho-receiving-sync. Zoho is SoR. Receiving redesign Phase 0.';
COMMENT ON COLUMN receiving_lines.receiving_line_status IS
  'Coarse operator lifecycle INCOMING|SCANNED|UNBOXED|RECEIVED, derived from workflow_status via one derive-SoT. PROBLEM is an orthogonal exception dimension (exception_code), not a value here. NULLABLE TEXT — no CHECK until the enum cutover migration.';
COMMENT ON COLUMN receiving_lines.exception_code IS
  'Per-line exception (NO_PO|CARRIER_MISMATCH|SHORT|OVER|DAMAGED|WRONG_ITEM|...); line-level home replacing carton-only receiving.exception_code. Receiving redesign Phase 0.';
