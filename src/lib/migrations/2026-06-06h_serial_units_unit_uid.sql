-- ============================================================================
-- 2026-06-06: serial_units.unit_uid — first-class persisted unit identity
-- ============================================================================
-- The printed unit identity {SKU_SHORT}-{YYWW}-{SEQ6} (e.g. 00098-2621-000142)
-- was generated at print time but never stored as a column — it lived only in
-- station_activity_logs.metadata + inventory_events scan tokens. That meant a
-- scan of the bare unit-id QR had no indexed row to resolve to (it 404'd), and
-- reprint had to string-reconstruct rather than look the unit up.
--
-- This makes unit_uid a real column so the QR is a true external key: each
-- physical unit owns exactly one, stamped when first labeled.
--
-- Org-scoped UNIQUE because serial_units carries organization_id + RLS
-- (2026-05-23). Nullable + PARTIAL unique index so legacy / not-yet-labeled
-- rows (which have no minted id) coexist; only populated values are enforced
-- unique. Additive only — no existing flow changes until the writer is wired.
-- See docs/serial-unit-uid-plan.md (Phase 1, Step 1).
-- ============================================================================

BEGIN;

ALTER TABLE serial_units
  ADD COLUMN IF NOT EXISTS unit_uid text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_serial_units_org_unit_uid
  ON serial_units (organization_id, unit_uid)
  WHERE unit_uid IS NOT NULL;

COMMENT ON COLUMN serial_units.unit_uid IS
  'USAV-minted unit identity {SKU_SHORT}-{YYWW}-{SEQ6}, stamped at first label. '
  'Org-unique (partial index). NULL until the unit is labeled.';

COMMIT;
