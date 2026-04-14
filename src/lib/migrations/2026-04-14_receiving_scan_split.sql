-- Receiving scan split: per-carton audit trail in `receiving_scans`,
-- one receiving row per Zoho PO when matched (source='zoho_po'),
-- one receiving row per loose scan when no PO (source='unmatched').
--
-- Idempotent — safe to re-run.

BEGIN;

-- 1. receiving_scans: per-carton audit trail. Created first so the backfill
--    and dedup steps below can reference it.
CREATE TABLE IF NOT EXISTS receiving_scans (
  id              SERIAL PRIMARY KEY,
  receiving_id    INTEGER NOT NULL REFERENCES receiving(id) ON DELETE CASCADE,
  tracking_number TEXT NOT NULL,
  carrier         TEXT,
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scanned_by      INTEGER REFERENCES staff(id),
  source          TEXT NOT NULL CHECK (source IN ('zoho_po', 'unmatched')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receiving_scans_receiving_id
  ON receiving_scans(receiving_id);
CREATE INDEX IF NOT EXISTS idx_receiving_scans_tracking
  ON receiving_scans(tracking_number);
CREATE UNIQUE INDEX IF NOT EXISTS ux_receiving_scans_tracking_receiving
  ON receiving_scans(tracking_number, receiving_id);

-- 2. receiving.source column (nullable first, backfill, then enforce).
ALTER TABLE receiving
  ADD COLUMN IF NOT EXISTS source TEXT;

UPDATE receiving
SET source = CASE
  WHEN (zoho_purchaseorder_id IS NOT NULL AND zoho_purchaseorder_id <> '')
    OR (zoho_purchase_receive_id IS NOT NULL AND zoho_purchase_receive_id <> '')
  THEN 'zoho_po'
  ELSE 'unmatched'
END
WHERE source IS NULL;

ALTER TABLE receiving
  ALTER COLUMN source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'receiving_source_chk'
  ) THEN
    ALTER TABLE receiving
      ADD CONSTRAINT receiving_source_chk
      CHECK (source IN ('zoho_po', 'unmatched'));
  END IF;
END $$;

-- 3. Partial unique index for PO-keyed upsert on matched scans.
--    Unmatched rows are unconstrained (each loose scan gets its own row).
CREATE UNIQUE INDEX IF NOT EXISTS ux_receiving_zoho_po_matched
  ON receiving (zoho_purchaseorder_id)
  WHERE source = 'zoho_po' AND zoho_purchaseorder_id IS NOT NULL;

-- 4. Collapse any pre-existing duplicate PO rows (no-op in current data,
--    but keeps the migration safe for environments that accumulated dupes
--    before the unique index existed).
DO $$
DECLARE
  dup RECORD;
BEGIN
  FOR dup IN
    WITH grouped AS (
      SELECT zoho_purchaseorder_id,
             MIN(id) AS keep_id,
             ARRAY_AGG(id ORDER BY id) AS all_ids
      FROM receiving
      WHERE source = 'zoho_po'
        AND zoho_purchaseorder_id IS NOT NULL
        AND zoho_purchaseorder_id <> ''
      GROUP BY zoho_purchaseorder_id
      HAVING COUNT(*) > 1
    )
    SELECT zoho_purchaseorder_id,
           keep_id,
           (SELECT ARRAY_AGG(x) FROM UNNEST(all_ids) AS x WHERE x <> keep_id) AS dup_ids
    FROM grouped
  LOOP
    -- Preserve scan history from the rows we are about to delete.
    INSERT INTO receiving_scans
      (receiving_id, tracking_number, carrier, scanned_at, scanned_by, source)
    SELECT dup.keep_id,
           r.receiving_tracking_number,
           r.carrier,
           COALESCE(r.received_at, r.receiving_date_time, NOW()),
           r.received_by,
           'zoho_po'
    FROM receiving r
    WHERE r.id = ANY(dup.dup_ids)
      AND r.receiving_tracking_number IS NOT NULL
      AND r.receiving_tracking_number <> ''
    ON CONFLICT (tracking_number, receiving_id) DO NOTHING;

    -- Re-parent surviving lines, then drop the duplicates.
    UPDATE receiving_lines
       SET receiving_id = dup.keep_id
     WHERE receiving_id = ANY(dup.dup_ids);

    DELETE FROM receiving WHERE id = ANY(dup.dup_ids);
  END LOOP;
END $$;

-- 5. Backfill receiving_scans from existing receiving.receiving_tracking_number
--    so every row that had a tracking# keeps its audit trail.
INSERT INTO receiving_scans
  (receiving_id, tracking_number, carrier, scanned_at, scanned_by, source)
SELECT
  r.id,
  r.receiving_tracking_number,
  r.carrier,
  COALESCE(r.received_at, r.receiving_date_time, NOW()),
  r.received_by,
  r.source
FROM receiving r
WHERE r.receiving_tracking_number IS NOT NULL
  AND r.receiving_tracking_number <> ''
ON CONFLICT (tracking_number, receiving_id) DO NOTHING;

-- 6. Backward-compat read view — lets existing reporting/global-search
--    consumers read the latest scan tracking without knowing about
--    receiving_scans. Drop after reader cutover.
CREATE OR REPLACE VIEW receiving_with_tracking AS
SELECT r.*,
       COALESCE(
         (SELECT rs.tracking_number
            FROM receiving_scans rs
           WHERE rs.receiving_id = r.id
           ORDER BY rs.scanned_at DESC, rs.id DESC
           LIMIT 1),
         r.receiving_tracking_number
       ) AS latest_tracking_number
FROM receiving r;

COMMIT;
