-- ============================================================================
-- 2026-04-15: Retire the legacy `sku` table
-- ============================================================================
-- Goal: stop using `sku` for new writes. Keep the table physically in place
-- with all historical rows intact as a frozen archive + legacy FK target.
--
-- What this migration does:
--   1. Extend `serial_units` with the columns previously unique to `sku`
--      (shipping_tracking_number, shipment_id, legacy_notes, legacy_date_time)
--      so no functionality is lost when callers switch writes.
--   2. Backfill `serial_units` from every serial-bearing row in `sku`, one
--      row per comma-delimited serial, origin_source='legacy'.
--   3. Create `v_sku` — a read-only compat VIEW that exposes `serial_units`
--      in the old `sku` column shape. Readers migrate via `FROM sku` →
--      `FROM v_sku` when they need live data.
--   4. Extend `photos.entity_type` to accept 'SERIAL_UNIT' + update the
--      validation trigger. Existing 'SKU' rows remain valid against the
--      frozen `sku` table.
--   5. Freeze INSERTs on `sku` with a BEFORE INSERT trigger. UPDATE/DELETE
--      stay permitted so admins can clean up / backfill FKs on legacy rows.
--
-- What this migration does NOT do:
--   - DROP `sku` (intentionally preserved)
--   - Rewrite reader callsites (done in application code)
-- ============================================================================

BEGIN;

-- ─── 1. Extend serial_units with legacy-coverage columns ───────────────────
ALTER TABLE serial_units
  ADD COLUMN IF NOT EXISTS shipping_tracking_number TEXT,
  ADD COLUMN IF NOT EXISTS shipment_id              BIGINT,
  ADD COLUMN IF NOT EXISTS legacy_notes             TEXT,
  ADD COLUMN IF NOT EXISTS legacy_date_time         TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_serial_units_tracking
  ON serial_units (shipping_tracking_number)
  WHERE shipping_tracking_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_serial_units_shipment
  ON serial_units (shipment_id)
  WHERE shipment_id IS NOT NULL;

COMMENT ON COLUMN serial_units.shipping_tracking_number IS
  'Inbound/outbound tracking number associated with this serial. Replaces sku.shipping_tracking_number.';
COMMENT ON COLUMN serial_units.shipment_id IS
  'FK to shipping_tracking_numbers.id when resolved. Replaces sku.shipment_id.';
COMMENT ON COLUMN serial_units.legacy_notes IS
  'Free-form notes copied from the retired sku.notes column during backfill. New notes should use serial_units.notes.';
COMMENT ON COLUMN serial_units.legacy_date_time IS
  'Date stamp preserved from the retired sku.date_time column.';

-- ─── 2. Backfill serial_units from sku (one row per CSV serial) ───────────
-- A single sku row may list the same serial twice (e.g. "A,A"), and two
-- separate sku rows may reference the same physical unit. DISTINCT ON
-- collapses those to one normalized_serial so ON CONFLICT never has to
-- resolve duplicates within a single INSERT.
WITH raw_exploded AS (
  SELECT
    s.id                                                    AS origin_sku_id,
    s.static_sku                                            AS sku,
    BTRIM(unnest(string_to_array(s.serial_number, ',')))    AS serial_number,
    s.shipping_tracking_number                              AS tracking,
    s.shipment_id                                           AS shipment_id,
    s.notes                                                 AS legacy_notes,
    s.location                                              AS current_location,
    s.date_time                                             AS legacy_date_time,
    s.created_at,
    s.updated_at
  FROM sku s
  WHERE s.serial_number IS NOT NULL
    AND BTRIM(s.serial_number) <> ''
),
exploded AS (
  SELECT DISTINCT ON (UPPER(BTRIM(serial_number)))
    origin_sku_id, sku, serial_number, tracking, shipment_id,
    legacy_notes, current_location, legacy_date_time, created_at, updated_at
  FROM raw_exploded
  WHERE BTRIM(serial_number) <> ''
  ORDER BY UPPER(BTRIM(serial_number)), origin_sku_id ASC
)
INSERT INTO serial_units (
  serial_number,
  normalized_serial,
  sku,
  sku_catalog_id,
  current_status,
  current_location,
  origin_source,
  origin_sku_id,
  shipping_tracking_number,
  shipment_id,
  legacy_notes,
  legacy_date_time,
  created_at,
  updated_at
)
SELECT
  e.serial_number,
  UPPER(BTRIM(e.serial_number)),
  e.sku,
  sc.id,
  'UNKNOWN'::serial_status_enum,
  e.current_location,
  'legacy',
  e.origin_sku_id,
  e.tracking,
  e.shipment_id,
  e.legacy_notes,
  e.legacy_date_time,
  COALESCE(e.created_at, NOW()),
  COALESCE(e.updated_at, NOW())
FROM exploded e
LEFT JOIN sku_catalog sc
  ON UPPER(BTRIM(e.sku)) = UPPER(BTRIM(sc.sku))
WHERE BTRIM(e.serial_number) <> ''
ON CONFLICT (normalized_serial) DO UPDATE SET
  -- Fill-in only. Never clobber lifecycle state the app has already set.
  shipping_tracking_number = COALESCE(serial_units.shipping_tracking_number, EXCLUDED.shipping_tracking_number),
  shipment_id              = COALESCE(serial_units.shipment_id,              EXCLUDED.shipment_id),
  legacy_notes             = COALESCE(serial_units.legacy_notes,             EXCLUDED.legacy_notes),
  legacy_date_time         = COALESCE(serial_units.legacy_date_time,         EXCLUDED.legacy_date_time),
  origin_sku_id            = COALESCE(serial_units.origin_sku_id,            EXCLUDED.origin_sku_id),
  sku                      = COALESCE(serial_units.sku,                      EXCLUDED.sku),
  sku_catalog_id           = COALESCE(serial_units.sku_catalog_id,           EXCLUDED.sku_catalog_id),
  current_location         = COALESCE(serial_units.current_location,         EXCLUDED.current_location),
  updated_at               = NOW();

-- ─── 3. Read-compat VIEW: v_sku ────────────────────────────────────────────
-- Exposes serial_units in the legacy sku column shape. Callsites migrate
-- incrementally via: FROM sku → FROM v_sku.
--
-- Branch A: rows that originated in the legacy sku table keep their id
-- (grouped back into CSV form).
-- Branch B: post-retirement rows synthesize an id (serial_units.id +
-- 1_000_000_000) so they never collide with real sku.id values.
DROP VIEW IF EXISTS v_sku;
CREATE VIEW v_sku AS
SELECT
  su.origin_sku_id                                           AS id,
  MIN(su.legacy_date_time)                                   AS date_time,
  MIN(su.sku)                                                AS static_sku,
  string_agg(DISTINCT su.serial_number, ', '
             ORDER BY su.serial_number)                      AS serial_number,
  MIN(su.shipping_tracking_number)                           AS shipping_tracking_number,
  MIN(su.legacy_notes)                                       AS notes,
  MIN(su.current_location)                                   AS location,
  MIN(su.created_at)                                         AS created_at,
  MAX(su.updated_at)                                         AS updated_at,
  MIN(su.shipment_id)                                        AS shipment_id,
  MIN(su.id)                                                 AS serial_unit_id
FROM serial_units su
WHERE su.origin_sku_id IS NOT NULL
GROUP BY su.origin_sku_id
UNION ALL
SELECT
  (su.id + 1000000000)                                       AS id,
  su.created_at                                              AS date_time,
  su.sku                                                     AS static_sku,
  su.serial_number                                           AS serial_number,
  su.shipping_tracking_number                                AS shipping_tracking_number,
  COALESCE(su.legacy_notes, su.notes)                        AS notes,
  su.current_location                                        AS location,
  su.created_at,
  su.updated_at,
  su.shipment_id,
  su.id                                                      AS serial_unit_id
FROM serial_units su
WHERE su.origin_sku_id IS NULL;

COMMENT ON VIEW v_sku IS
  'Compat view: serial_units presented in the legacy sku column shape. Read-only. Use FROM v_sku to replace FROM sku in queries that need live data.';

-- ─── 4. photos.entity_type accepts 'SERIAL_UNIT' ──────────────────────────
ALTER TABLE photos
  DROP CONSTRAINT IF EXISTS chk_photos_entity_type;

ALTER TABLE photos
  ADD CONSTRAINT chk_photos_entity_type
    CHECK (entity_type IN ('RECEIVING', 'PACKER_LOG', 'SKU', 'SERIAL_UNIT'));

CREATE OR REPLACE FUNCTION fn_validate_photo_entity_ref()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entity_type = 'PACKER_LOG' THEN
    IF NOT EXISTS (SELECT 1 FROM packer_logs WHERE id = NEW.entity_id) THEN
      RAISE EXCEPTION 'photos.entity_id % does not exist in packer_logs', NEW.entity_id;
    END IF;
  ELSIF NEW.entity_type = 'RECEIVING' THEN
    IF NOT EXISTS (SELECT 1 FROM receiving WHERE id = NEW.entity_id) THEN
      RAISE EXCEPTION 'photos.entity_id % does not exist in receiving', NEW.entity_id;
    END IF;
  ELSIF NEW.entity_type = 'SKU' THEN
    -- Kept for legacy rows; sku is frozen-archive post-retirement (2026-04-15)
    IF NOT EXISTS (SELECT 1 FROM sku WHERE id = NEW.entity_id) THEN
      RAISE EXCEPTION 'photos.entity_id % does not exist in sku', NEW.entity_id;
    END IF;
  ELSIF NEW.entity_type = 'SERIAL_UNIT' THEN
    IF NOT EXISTS (SELECT 1 FROM serial_units WHERE id = NEW.entity_id) THEN
      RAISE EXCEPTION 'photos.entity_id % does not exist in serial_units', NEW.entity_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported photos.entity_type: %', NEW.entity_type;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_photos_on_serial_unit_delete ON serial_units;
CREATE TRIGGER trg_delete_photos_on_serial_unit_delete
AFTER DELETE ON serial_units
FOR EACH ROW EXECUTE FUNCTION fn_delete_photos_on_parent_delete('SERIAL_UNIT');

-- ─── 5. Freeze INSERTs on sku ─────────────────────────────────────────────
-- Block all new inserts. UPDATE/DELETE remain permitted so admins can
-- backfill serial_unit_id FKs or clean up bad legacy rows without having
-- to lift a DB-level lock.
CREATE OR REPLACE FUNCTION fn_block_sku_inserts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'sku table was retired 2026-04-15. INSERTs are blocked. Write to serial_units via upsertSerialUnit() instead.';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_sku_inserts ON sku;
CREATE TRIGGER trg_block_sku_inserts
BEFORE INSERT ON sku
FOR EACH ROW EXECUTE FUNCTION fn_block_sku_inserts();

COMMENT ON TABLE sku IS
  'RETIRED 2026-04-15. INSERTs blocked by trg_block_sku_inserts. Historical rows preserved as archive + legacy FK target. New writes go to serial_units. Read live data via v_sku.';

COMMIT;
