-- ─── Locations: defined physical places in the warehouse ─────────────────────

CREATE TABLE IF NOT EXISTS locations (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,               -- e.g. "Warehouse A", "Shelf B-3"
  zone        TEXT,                                -- grouping: "Warehouse", "Showroom", "Returns", "Testing"
  description TEXT,                                -- optional notes about this location
  barcode     TEXT UNIQUE,                         -- scannable barcode/QR for this location
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,       -- soft-delete / archive
  sort_order  INTEGER NOT NULL DEFAULT 0,          -- display ordering
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_locations_zone ON locations (zone);
CREATE INDEX IF NOT EXISTS idx_locations_barcode ON locations (barcode) WHERE barcode IS NOT NULL;

-- Seed common locations for a 5-person warehouse
INSERT INTO locations (name, zone, sort_order) VALUES
  ('Warehouse',   'Warehouse',  10),
  ('Showroom',    'Showroom',   20),
  ('Returns',     'Returns',    30),
  ('Testing',     'Testing',    40),
  ('Shipping',    'Shipping',   50),
  ('Storage A',   'Warehouse',  60),
  ('Storage B',   'Warehouse',  70),
  ('Receiving',   'Receiving',  80)
ON CONFLICT (name) DO NOTHING;

-- ─── Location transfer log: tracks every location change ─────────────────────

CREATE TABLE IF NOT EXISTS location_transfers (
  id              SERIAL PRIMARY KEY,
  entity_type     TEXT NOT NULL,                   -- 'SKU_STOCK' | 'SKU_RECORD'
  entity_id       INTEGER NOT NULL,                -- id from sku_stock or sku table
  sku             TEXT NOT NULL,                    -- denormalized for fast lookups
  from_location   TEXT,                             -- null if first assignment
  to_location     TEXT NOT NULL,
  staff_id        INTEGER,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_location_transfers_sku ON location_transfers (sku);
CREATE INDEX IF NOT EXISTS idx_location_transfers_created ON location_transfers (created_at DESC);

COMMENT ON TABLE locations IS 'Defined physical locations in the warehouse';
COMMENT ON TABLE location_transfers IS 'Audit log for every location change on SKU inventory';
