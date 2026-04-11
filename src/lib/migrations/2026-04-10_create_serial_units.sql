-- ============================================================================
-- 2026-04-10: Serial Units master registry
-- ============================================================================
-- Aggregate-root table for every physical serialized unit. Cradle-to-grave
-- lifecycle: RECEIVED -> TESTED -> STOCKED -> PICKED -> SHIPPED -> RETURNED.
--
-- Relaxed mode: origin_* and received_* fields are nullable so legacy serials
-- (first seen at TSN/sku/ship time without a receiving context) are still
-- first-class citizens. sku_catalog_id stays nullable forever — a unit may
-- reference a sku that hasn't been mirrored from Zoho yet.
--
-- Downstream tables (tech_serial_numbers, sku) will gain nullable FK columns
-- in a later migration. This one is purely additive.
-- ============================================================================

BEGIN;

-- ─── Lifecycle status enum ──────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE serial_status_enum AS ENUM (
    'UNKNOWN',   -- first seen without origin context (legacy/backfill)
    'RECEIVED',  -- scanned at receiving, in building
    'TESTED',    -- passed QA
    'STOCKED',   -- in sku stock ledger with a location
    'PICKED',    -- allocated to an order
    'SHIPPED',   -- outbound
    'RETURNED',  -- came back after shipping
    'RMA',       -- return-to-vendor pending
    'SCRAPPED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Master table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS serial_units (
  id                       SERIAL PRIMARY KEY,
  serial_number            TEXT NOT NULL,
  normalized_serial        TEXT NOT NULL,
  sku                      TEXT,
  sku_catalog_id           INTEGER REFERENCES sku_catalog(id) ON DELETE SET NULL,
  zoho_item_id             TEXT,

  current_status           serial_status_enum NOT NULL DEFAULT 'UNKNOWN',
  current_location         TEXT,
  condition_grade          condition_grade_enum,

  origin_source            TEXT,
  origin_receiving_line_id INTEGER REFERENCES receiving_lines(id) ON DELETE SET NULL,
  origin_tsn_id            INTEGER,
  origin_sku_id            INTEGER,

  received_at              TIMESTAMPTZ,
  received_by              INTEGER,

  notes                    TEXT,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT serial_units_normalized_uniq UNIQUE (normalized_serial)
);

CREATE INDEX IF NOT EXISTS idx_serial_units_lookup
  ON serial_units (normalized_serial);

CREATE INDEX IF NOT EXISTS idx_serial_units_sku
  ON serial_units (sku) WHERE sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_serial_units_catalog
  ON serial_units (sku_catalog_id) WHERE sku_catalog_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_serial_units_status
  ON serial_units (current_status);

CREATE INDEX IF NOT EXISTS idx_serial_units_origin_line
  ON serial_units (origin_receiving_line_id)
  WHERE origin_receiving_line_id IS NOT NULL;

COMMENT ON TABLE serial_units IS
  'Master registry for every serialized physical unit. Aggregate root for serial lifecycle. Relaxed mode: origin fields nullable for legacy/backfill.';

COMMIT;
