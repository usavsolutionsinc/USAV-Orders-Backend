-- ============================================================================
-- 2026-06-28h: final backfill of receiving.shipment_id before dropping the
--              legacy receiving.receiving_tracking_number text column
-- ============================================================================
-- The legacy text column is being retired in favour of the canonical STN
-- (shipping_tracking_numbers, joined via receiving.shipment_id). This migration
-- guarantees no tracking is lost when the column is dropped (next migration,
-- 2026-06-28i):
--
--   1. Register every still-unlinked receiving row's tracking text into STN
--      (idempotent; ON CONFLICT DO NOTHING on the normalized unique index).
--   2. Link receiving.shipment_id from the registered STN row.
--   3. GUARD: abort the whole migration if any row would still lose a usable
--      tracking on the drop (≥8 alphanumerics, not a SKU scan, not a zoho_po PO
--      id) — RAISE EXCEPTION so the drop never runs against incomplete data.
--
-- source='zoho_po' rows are EXCLUDED: their legacy column holds a Zoho PO id,
-- NOT a carrier tracking (their real tracking is already in STN via the incoming
-- sync). Dropping their legacy value is lossless.
--
-- Safe to re-run. Mirrors the proven pattern in
-- 2026-04-15_backfill_receiving_shipment_id.sql.
-- ============================================================================

BEGIN;

-- ── 1. Register distinct usable trackings into STN ──────────────────────────
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
  'backfill_stn_final'
FROM receiving r
WHERE r.shipment_id IS NULL
  AND r.source IS DISTINCT FROM 'zoho_po'
  AND r.receiving_tracking_number IS NOT NULL
  AND r.receiving_tracking_number <> ''
  AND r.receiving_tracking_number NOT LIKE '%:%'
  AND LENGTH(UPPER(REGEXP_REPLACE(r.receiving_tracking_number, '[^A-Za-z0-9]', '', 'g'))) >= 8
ON CONFLICT (tracking_number_normalized) DO NOTHING;

-- ── 2. Link receiving.shipment_id from the STN row ──────────────────────────
UPDATE receiving r
   SET shipment_id = stn.id,
       updated_at  = now()
  FROM shipping_tracking_numbers stn
 WHERE stn.tracking_number_normalized =
         UPPER(REGEXP_REPLACE(COALESCE(r.receiving_tracking_number, ''), '[^A-Za-z0-9]', '', 'g'))
   AND r.shipment_id IS NULL
   AND r.source IS DISTINCT FROM 'zoho_po'
   AND r.receiving_tracking_number IS NOT NULL
   AND r.receiving_tracking_number <> '';

-- ── 3. GUARD — refuse to proceed if any usable tracking is still unlinked ────
DO $$
DECLARE orphan_count int;
BEGIN
  SELECT count(*) INTO orphan_count
    FROM receiving r
   WHERE r.shipment_id IS NULL
     AND r.source IS DISTINCT FROM 'zoho_po'
     AND r.receiving_tracking_number IS NOT NULL
     AND r.receiving_tracking_number <> ''
     AND r.receiving_tracking_number NOT LIKE '%:%'
     AND LENGTH(UPPER(REGEXP_REPLACE(r.receiving_tracking_number, '[^A-Za-z0-9]', '', 'g'))) >= 8;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Backfill incomplete: % receiving row(s) still carry an unlinked tracking. Refusing to advance to the column drop — investigate before applying 2026-06-28i.',
      orphan_count;
  END IF;
END$$;

COMMIT;

-- ── Post-run validation (run manually) ──────────────────────────────────────
-- SELECT count(*) FILTER (WHERE shipment_id IS NOT NULL) AS linked,
--        count(*) FILTER (WHERE shipment_id IS NULL
--                          AND source IS DISTINCT FROM 'zoho_po'
--                          AND receiving_tracking_number <> '') AS unlinked_nonpo,
--        count(*) AS total
--   FROM receiving;
