-- ============================================================================
-- 2026-05-21: Inventory v2 — UNSORTED default putaway bin (Phase 0.5)
-- ============================================================================
-- Creates a single 'UNSORTED' location row that the mark-received endpoint
-- uses as the default destination when no `destination_bin_id` is supplied.
--
-- Context:
--   INVENTORY_V2_RECEIVING_PUTAWAY is already ON in production, but the
--   receiving UI never sends a destination_bin_id, so every recently
--   received unit is stuck at current_status='RECEIVED'. That blocks
--   allocation (allocateOrder requires STOCKED). Default-bin fallback
--   means new receives auto-stock without any UI changes.
--
-- Properties:
--   bin_role = 'RESERVE'   → pickability predicate allows it (other roles
--                            like STAGING / RECEIVING / QUARANTINE block it).
--   sort_order = 999       → sorts to the END of walking-path queues so
--                            pickers naturally walk real bins first when
--                            both an UNSORTED unit and a binned unit are
--                            available for the same SKU.
--   zone_letter = 'Z'      → keeps it visually last in supervisor views.
--   is_active = true       → eligible for selection / scan.
--   warehouse_id = 1       → matches the existing locations.
--   organization_id is set per-tenant; this migration writes the USAV row.
--
-- Idempotent: ON CONFLICT (organization_id, barcode) DO NOTHING. Safe to
-- re-run.
-- ============================================================================

BEGIN;

-- Some deployments don't have a UNIQUE on (organization_id, barcode). Use
-- a NOT EXISTS guard so the migration is replay-safe regardless.
INSERT INTO locations (
  name, room, barcode, is_active, sort_order,
  bin_role, locked_for_count,
  warehouse_id, zone_letter,
  organization_id
)
SELECT
  'UNSORTED',
  'Unsorted',
  'UNSORTED',
  TRUE,
  999,
  'RESERVE',
  FALSE,
  1,
  'Z',
  '00000000-0000-0000-0000-000000000001'::uuid
WHERE NOT EXISTS (
  SELECT 1 FROM locations
   WHERE barcode = 'UNSORTED'
     AND organization_id = '00000000-0000-0000-0000-000000000001'::uuid
);

COMMENT ON COLUMN locations.bin_role IS
  'Bin role for pickability filtering. RESERVE = allocatable, others (STAGING/QUARANTINE/etc.) are excluded by pickableSerialUnitsWhereClause(). UNSORTED bin uses RESERVE so picker can find auto-stocked units.';

COMMIT;

-- After applying, capture the id for the env var:
--   SELECT id FROM locations WHERE barcode = 'UNSORTED' AND organization_id = '00000000-0000-0000-0000-000000000001';
-- Set in Vercel:
--   RECEIVING_DEFAULT_PUTAWAY_BIN_BARCODE=UNSORTED
-- (mark-received resolves barcode → id at runtime, caches per-instance.)
