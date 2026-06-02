-- ============================================================================
-- 2026-06-02: Parts bin — Technical Room destination for "For Parts" units
-- ============================================================================
-- Seeds a single 'TECH-PARTS' location that the auto-sort engine uses as the
-- destination when a serial unit's condition is set to PARTS ("For Parts").
--
-- Context:
--   A unit graded PARTS does not need testing or a claim — it should be sorted
--   straight into a Parts bin that physically lives in the Technical Room.
--   Parts are sellable AND repair stock, so the bin must stay PICKABLE.
--
-- Properties:
--   bin_role = 'RESERVE'   → pickability predicate allows it, so parts land in
--                            normal sellable stock (sellable + usable for repair).
--   sort_order = 998       → sorts near the end of walking-path queues (just
--                            ahead of UNSORTED=999) so pickers prefer real bins.
--   zone_letter = NULL     → bins don't carry a zone letter (only parent room
--                            rows do); a value would collide with the UNSORTED
--                            bin under idx_locations_zone_letter_unique_active.
--   room = 'Technical Room'→ physical home of the bin.
--   is_active = true       → eligible for selection / scan.
--   warehouse_id = 1       → matches the existing locations.
--
-- Idempotent: NOT EXISTS guard on (organization_id, barcode). Safe to re-run.
-- ============================================================================

BEGIN;

INSERT INTO locations (
  name, room, barcode, is_active, sort_order,
  bin_role, locked_for_count,
  warehouse_id, zone_letter,
  organization_id
)
SELECT
  'Tech Room — Parts',
  'Technical Room',
  'TECH-PARTS',
  TRUE,
  998,
  'RESERVE',
  FALSE,
  1,
  NULL,
  '00000000-0000-0000-0000-000000000001'::uuid
WHERE NOT EXISTS (
  SELECT 1 FROM locations
   WHERE barcode = 'TECH-PARTS'
     AND organization_id = '00000000-0000-0000-0000-000000000001'::uuid
);

COMMIT;

-- After applying, set in Vercel (mark-received / parts-sort resolve barcode →
-- id at runtime and cache per-instance):
--   PARTS_BIN_BARCODE=TECH-PARTS
