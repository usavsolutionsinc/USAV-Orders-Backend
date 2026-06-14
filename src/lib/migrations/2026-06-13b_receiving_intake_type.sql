-- ============================================================================
-- 2026-06-13: receiving.intake_type (carton-level default receiving type)
-- ============================================================================
-- Platform is stored per-carton (receiving.source_platform); type was only
-- per-line (receiving_lines.receiving_type). This adds a carton-level DEFAULT
-- so the carton pill behaves like the platform pill — one type per PO# — while
-- per-line `receiving_lines.receiving_type` continues to act as an OVERRIDE.
--
--   Effective line type = receiving_lines.receiving_type (override)
--                      ?? receiving.intake_type            (carton default)
--                      ?? 'PO'.
--
--   NULL = no carton default set → falls back to 'PO' (the behavior for every
--          carton that pre-dates this column, modulo the backfill below).
--   Values: 'PO' | 'RETURN' | 'TRADE_IN' (PICKUP is a separate carton source,
--           not a pill type — see RECEIVING_TYPE_OPTS).
--
-- Additive + idempotent. Backfills the carton default from any non-PO line type
-- already recorded, so existing RETURN/TRADE_IN cartons keep reading correctly
-- in the new carton-level pill instead of flashing 'PO'.
-- ============================================================================

BEGIN;

ALTER TABLE receiving
  ADD COLUMN IF NOT EXISTS intake_type TEXT;

ALTER TABLE receiving
  DROP CONSTRAINT IF EXISTS receiving_intake_type_allowed;
ALTER TABLE receiving
  ADD CONSTRAINT receiving_intake_type_allowed
  CHECK (intake_type IS NULL OR intake_type IN ('PO', 'RETURN', 'TRADE_IN'));

-- Seed the carton default from the predominant non-PO line type so a carton
-- whose lines were tagged RETURN/TRADE_IN keeps that reading at carton level.
UPDATE receiving r
  SET intake_type = sub.rt
  FROM (
    SELECT receiving_id, MAX(UPPER(receiving_type)) AS rt
    FROM receiving_lines
    WHERE receiving_type IS NOT NULL
      AND UPPER(receiving_type) IN ('RETURN', 'TRADE_IN')
    GROUP BY receiving_id
  ) sub
  WHERE r.id = sub.receiving_id
    AND r.intake_type IS NULL;

COMMENT ON COLUMN receiving.intake_type IS
  'Carton-level default receiving type (PO|RETURN|TRADE_IN). The carton pill edits this; receiving_lines.receiving_type overrides per line. Effective = line override ?? carton default ?? ''PO''.';

COMMIT;
