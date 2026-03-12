-- Unify FNSKU activity into a shared event ledger for tech, pack, and ship flows.
-- This migration hardens fba_fnskus as the canonical FNSKU dimension, creates
-- fba_fnsku_logs, and adds nullable FBA linkage columns to tech_serial_numbers.

BEGIN;

DO $$
BEGIN
  CREATE TYPE fba_shipment_status_enum AS ENUM ('PLANNED','READY_TO_GO','LABEL_ASSIGNED','SHIPPED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Canonical FNSKU dimension ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fba_fnskus (
  fnsku         TEXT PRIMARY KEY,
  product_title TEXT,
  asin          TEXT,
  sku           TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- If the table already existed in a looser form, add the new columns first.
ALTER TABLE fba_fnskus ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE fba_fnskus ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE fba_fnskus ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE fba_fnskus ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Normalize and deduplicate existing values before adding strict constraints.
UPDATE fba_fnskus
SET
  fnsku = UPPER(TRIM(COALESCE(fnsku, ''))),
  product_title = NULLIF(TRIM(COALESCE(product_title, '')), ''),
  asin = NULLIF(UPPER(TRIM(COALESCE(asin, ''))), ''),
  sku = NULLIF(TRIM(COALESCE(sku, '')), ''),
  last_seen_at = COALESCE(last_seen_at, NOW()),
  updated_at = NOW()
WHERE fnsku IS NOT NULL;

DELETE FROM fba_fnskus
WHERE COALESCE(TRIM(fnsku), '') = '';

WITH ranked AS (
  SELECT
    ctid,
    fnsku,
    ROW_NUMBER() OVER (
      PARTITION BY fnsku
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, ctid DESC
    ) AS rn
  FROM fba_fnskus
)
DELETE FROM fba_fnskus f
USING ranked r
WHERE f.ctid = r.ctid
  AND r.rn > 1;

ALTER TABLE fba_fnskus
  ALTER COLUMN fnsku SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fba_fnskus_pkey'
      AND conrelid = 'fba_fnskus'::regclass
  ) THEN
    ALTER TABLE fba_fnskus ADD CONSTRAINT fba_fnskus_pkey PRIMARY KEY (fnsku);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fba_fnskus_sku
  ON fba_fnskus(sku)
  WHERE sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fba_fnskus_asin
  ON fba_fnskus(asin)
  WHERE asin IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fba_fnskus_active
  ON fba_fnskus(is_active, updated_at DESC);

-- ── FBA shipment metadata alignment ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fba_shipments (
  id                   SERIAL PRIMARY KEY,
  shipment_ref         TEXT NOT NULL,
  destination_fc       TEXT,
  due_date             DATE,
  status               fba_shipment_status_enum NOT NULL DEFAULT 'PLANNED',
  created_by_staff_id  INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  assigned_tech_id     INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  assigned_packer_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  shipped_at           TIMESTAMPTZ,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fba_shipment_items (
  id                    SERIAL PRIMARY KEY,
  shipment_id           INTEGER NOT NULL REFERENCES fba_shipments(id) ON DELETE CASCADE,
  fnsku                 TEXT NOT NULL,
  product_title         TEXT,
  asin                  TEXT,
  sku                   TEXT,
  expected_qty          INTEGER NOT NULL DEFAULT 0,
  actual_qty            INTEGER NOT NULL DEFAULT 0,
  status                fba_shipment_status_enum NOT NULL DEFAULT 'PLANNED',
  ready_by_staff_id     INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  ready_at              TIMESTAMPTZ,
  verified_by_staff_id  INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  verified_at           TIMESTAMPTZ,
  labeled_by_staff_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  labeled_at            TIMESTAMPTZ,
  shipped_by_staff_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  shipped_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shipment_id, fnsku)
);

ALTER TABLE fba_shipments
  ADD COLUMN IF NOT EXISTS ready_item_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS packed_item_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipped_item_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE fba_shipment_items
  ALTER COLUMN fnsku SET NOT NULL;

UPDATE fba_shipment_items
SET fnsku = UPPER(TRIM(fnsku))
WHERE fnsku IS NOT NULL
  AND fnsku <> UPPER(TRIM(fnsku));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fba_shipment_items_fnsku_fkey'
      AND conrelid = 'fba_shipment_items'::regclass
  ) THEN
    ALTER TABLE fba_shipment_items
      ADD CONSTRAINT fba_shipment_items_fnsku_fkey
      FOREIGN KEY (fnsku) REFERENCES fba_fnskus(fnsku)
      ON UPDATE CASCADE
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fba_shipment_items_fnsku_status
  ON fba_shipment_items(fnsku, status, shipment_id);

-- ── Unified FNSKU event ledger ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fba_fnsku_logs (
  id                    BIGSERIAL PRIMARY KEY,
  fnsku                 TEXT NOT NULL REFERENCES fba_fnskus(fnsku) ON UPDATE CASCADE ON DELETE RESTRICT,
  source_stage          TEXT NOT NULL CHECK (source_stage IN ('TECH', 'PACK', 'SHIP', 'ADMIN')),
  event_type            TEXT NOT NULL CHECK (event_type IN ('SCANNED', 'READY', 'VERIFIED', 'BOXED', 'ASSIGNED', 'SHIPPED', 'UNASSIGNED', 'VOID')),
  staff_id              INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  tech_serial_number_id BIGINT REFERENCES tech_serial_numbers(id) ON DELETE SET NULL,
  fba_shipment_id       INTEGER REFERENCES fba_shipments(id) ON DELETE SET NULL,
  fba_shipment_item_id  INTEGER REFERENCES fba_shipment_items(id) ON DELETE SET NULL,
  quantity              INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  station               TEXT,
  notes                 TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fba_fnsku_logs_fnsku_created
  ON fba_fnsku_logs(fnsku, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fba_fnsku_logs_stage_event_created
  ON fba_fnsku_logs(source_stage, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fba_fnsku_logs_shipment_item
  ON fba_fnsku_logs(fba_shipment_id, fba_shipment_item_id);

CREATE INDEX IF NOT EXISTS idx_fba_fnsku_logs_tech_serial
  ON fba_fnsku_logs(tech_serial_number_id)
  WHERE tech_serial_number_id IS NOT NULL;

-- ── Tech serial linkage back to FBA logs/shipments ───────────────────────────

ALTER TABLE tech_serial_numbers
  ADD COLUMN IF NOT EXISTS fnsku TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS fnsku_log_id BIGINT REFERENCES fba_fnsku_logs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fba_shipment_id INTEGER REFERENCES fba_shipments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fba_shipment_item_id INTEGER REFERENCES fba_shipment_items(id) ON DELETE SET NULL;

UPDATE tech_serial_numbers
SET fnsku = UPPER(TRIM(fnsku))
WHERE fnsku IS NOT NULL
  AND fnsku <> UPPER(TRIM(fnsku));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tech_serial_numbers_fnsku_fkey'
      AND conrelid = 'tech_serial_numbers'::regclass
  ) THEN
    ALTER TABLE tech_serial_numbers
      ADD CONSTRAINT tech_serial_numbers_fnsku_fkey
      FOREIGN KEY (fnsku) REFERENCES fba_fnskus(fnsku)
      ON UPDATE CASCADE
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tech_serial_numbers_fnsku
  ON tech_serial_numbers(fnsku)
  WHERE fnsku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tech_serial_numbers_fnsku_log_id
  ON tech_serial_numbers(fnsku_log_id)
  WHERE fnsku_log_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tech_serial_numbers_fba_shipment_id
  ON tech_serial_numbers(fba_shipment_id)
  WHERE fba_shipment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tech_serial_numbers_fba_shipment_item_id
  ON tech_serial_numbers(fba_shipment_item_id)
  WHERE fba_shipment_item_id IS NOT NULL;

-- ── Historical backfill from tech serial scans ───────────────────────────────
-- Backfill only rows that have an FNSKU and are not already linked to a new log.

WITH inserted AS (
  INSERT INTO fba_fnsku_logs (
    fnsku,
    source_stage,
    event_type,
    staff_id,
    tech_serial_number_id,
    quantity,
    station,
    notes,
    metadata,
    created_at
  )
  SELECT
    tsn.fnsku,
    'TECH',
    'SCANNED',
    tsn.tested_by,
    tsn.id,
    1,
    'TECH_STATION',
    tsn.notes,
    jsonb_build_object(
      'backfilled', TRUE,
      'serial_number', tsn.serial_number,
      'serial_type', tsn.serial_type
    ),
    COALESCE(tsn.test_date_time::timestamptz, tsn.created_at::timestamptz, NOW())
  FROM tech_serial_numbers tsn
  WHERE tsn.fnsku IS NOT NULL
    AND tsn.fnsku <> ''
    AND tsn.fnsku_log_id IS NULL
  RETURNING id, tech_serial_number_id
)
UPDATE tech_serial_numbers tsn
SET fnsku_log_id = inserted.id
FROM inserted
WHERE tsn.id = inserted.tech_serial_number_id;

COMMIT;
