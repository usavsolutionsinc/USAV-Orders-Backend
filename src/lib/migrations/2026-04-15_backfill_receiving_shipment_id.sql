-- ============================================================================
-- 2026-04-15: backfill receiving.shipment_id
-- ============================================================================
-- Phase 6 of the inbound-tracking unification (see
-- 2026-04-15_receiving_attach_shipment_id.sql for phase list).
--
-- Populates receiving.shipment_id for historical rows by:
--   1. Registering each distinct receiving_tracking_number into
--      shipping_tracking_numbers (carrier='UNKNOWN' when receiving.carrier is
--      empty/'Unknown').
--   2. Registering each distinct receiving_lines.zoho_reference_number too
--      (if that column exists — it was added by
--      2026-04-12_receiving_lines_add_reference_number.sql).
--   3. Setting receiving.shipment_id from the normalized text tracking.
--   4. For receiving rows with no text tracking but whose child
--      receiving_lines carry a zoho_reference_number, promoting that
--      reference onto the package.
--
-- Safe to re-run — every INSERT uses ON CONFLICT DO NOTHING on the
-- tracking_number_normalized unique index, and every UPDATE is gated on
-- shipment_id IS NULL.
--
-- Mirrors the outbound backfill pattern from
-- 2026-03-10_attach_shipment_id.sql steps 3-7.
-- ============================================================================

BEGIN;

-- ── 1. Register distinct receiving.receiving_tracking_number values ─────────
INSERT INTO shipping_tracking_numbers (
  tracking_number_raw,
  tracking_number_normalized,
  carrier,
  source_system
)
SELECT DISTINCT ON (normalized)
  r.receiving_tracking_number,
  UPPER(REGEXP_REPLACE(r.receiving_tracking_number, '[^A-Za-z0-9]', '', 'g')) AS normalized,
  CASE
    WHEN r.carrier IS NULL OR r.carrier = '' OR UPPER(r.carrier) = 'UNKNOWN'
      THEN 'UNKNOWN'
    ELSE UPPER(r.carrier)
  END,
  'backfill_receiving'
FROM receiving r
WHERE r.receiving_tracking_number IS NOT NULL
  AND r.receiving_tracking_number <> ''
  AND LENGTH(UPPER(REGEXP_REPLACE(r.receiving_tracking_number, '[^A-Za-z0-9]', '', 'g'))) >= 8
  AND r.receiving_tracking_number NOT LIKE '%:%'
ON CONFLICT (tracking_number_normalized) DO NOTHING;

-- ── 2. Register distinct receiving_lines.zoho_reference_number (if column exists) ─
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'receiving_lines'
       AND column_name = 'zoho_reference_number'
  ) THEN
    EXECUTE $sql$
      INSERT INTO shipping_tracking_numbers (
        tracking_number_raw,
        tracking_number_normalized,
        carrier,
        source_system
      )
      SELECT DISTINCT ON (normalized)
        rl.zoho_reference_number,
        UPPER(REGEXP_REPLACE(rl.zoho_reference_number, '[^A-Za-z0-9]', '', 'g')) AS normalized,
        'UNKNOWN',
        'backfill_zoho_reference'
      FROM receiving_lines rl
      WHERE rl.zoho_reference_number IS NOT NULL
        AND rl.zoho_reference_number <> ''
        AND LENGTH(UPPER(REGEXP_REPLACE(rl.zoho_reference_number, '[^A-Za-z0-9]', '', 'g'))) >= 8
        AND rl.zoho_reference_number NOT LIKE '%:%'
      ON CONFLICT (tracking_number_normalized) DO NOTHING
    $sql$;
  END IF;
END$$;

-- ── 3. Link receiving.shipment_id from the package's text tracking (primary) ─
UPDATE receiving r
   SET shipment_id = stn.id
  FROM shipping_tracking_numbers stn
 WHERE stn.tracking_number_normalized =
         UPPER(REGEXP_REPLACE(COALESCE(r.receiving_tracking_number, ''), '[^A-Za-z0-9]', '', 'g'))
   AND r.receiving_tracking_number IS NOT NULL
   AND r.receiving_tracking_number <> ''
   AND r.shipment_id IS NULL;

-- ── 4. Promote zoho_reference_number onto packages that have no text tracking ─
--    (idempotent: only touches rows still missing shipment_id)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'receiving_lines'
       AND column_name = 'zoho_reference_number'
  ) THEN
    EXECUTE $sql$
      WITH line_refs AS (
        SELECT DISTINCT ON (rl.receiving_id)
          rl.receiving_id,
          rl.zoho_reference_number
        FROM receiving_lines rl
        WHERE rl.receiving_id IS NOT NULL
          AND rl.zoho_reference_number IS NOT NULL
          AND rl.zoho_reference_number <> ''
        ORDER BY rl.receiving_id, rl.id ASC
      )
      UPDATE receiving r
         SET shipment_id = stn.id
        FROM line_refs lr
        JOIN shipping_tracking_numbers stn
          ON stn.tracking_number_normalized =
               UPPER(REGEXP_REPLACE(lr.zoho_reference_number, '[^A-Za-z0-9]', '', 'g'))
       WHERE r.id = lr.receiving_id
         AND r.shipment_id IS NULL
    $sql$;
  END IF;
END$$;

COMMIT;

-- ── Post-run validation (run manually, not part of migration) ───────────────
-- SELECT COUNT(*) FILTER (WHERE shipment_id IS NOT NULL)                          AS linked,
--        COUNT(*) FILTER (WHERE shipment_id IS NULL AND receiving_tracking_number <> '') AS unlinked_text,
--        COUNT(*)                                                                 AS total
--   FROM receiving;
--
-- SELECT source_system, COUNT(*) FROM shipping_tracking_numbers GROUP BY 1 ORDER BY 1;
