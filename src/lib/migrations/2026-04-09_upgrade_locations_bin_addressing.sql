-- ─── Upgrade locations: add row/col bin addressing ──────────────────────────
-- Hierarchy: Zone (room label) → Name (human-friendly) → Row × Col = Bin
-- Barcode auto-generated as: Z{zone_num}-{ROW}-{COL}  e.g. Z1-A-03

-- Add new columns
ALTER TABLE locations ADD COLUMN IF NOT EXISTS row_label TEXT;       -- A, B, C... (shelf row)
ALTER TABLE locations ADD COLUMN IF NOT EXISTS col_label TEXT;       -- 01, 02, 03... (position)
ALTER TABLE locations ADD COLUMN IF NOT EXISTS bin_type  TEXT;       -- SHELF, FLOOR, WALL, PALLET, DRAWER
ALTER TABLE locations ADD COLUMN IF NOT EXISTS capacity  INTEGER;    -- max units this bin can hold (optional)
ALTER TABLE locations ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES locations(id); -- zone-level parent

-- Index for fast bin lookups
CREATE INDEX IF NOT EXISTS idx_locations_row_col ON locations (zone, row_label, col_label);
CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations (parent_id) WHERE parent_id IS NOT NULL;

-- ─── Bin contents: which SKU lives in which bin, and how many ───────────────

CREATE TABLE IF NOT EXISTS bin_contents (
  id            SERIAL PRIMARY KEY,
  location_id   INTEGER NOT NULL REFERENCES locations(id),
  sku           TEXT NOT NULL,
  qty           INTEGER NOT NULL DEFAULT 0,
  min_qty       INTEGER,              -- reorder alert threshold
  max_qty       INTEGER,              -- bin capacity for this SKU
  last_counted  TIMESTAMPTZ,          -- last physical count date
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (location_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_bin_contents_sku ON bin_contents (sku);
CREATE INDEX IF NOT EXISTS idx_bin_contents_location ON bin_contents (location_id);
CREATE INDEX IF NOT EXISTS idx_bin_contents_low_stock ON bin_contents (qty) WHERE min_qty IS NOT NULL;

COMMENT ON TABLE bin_contents IS 'Maps SKUs to physical bin locations with quantity tracking';

-- ─── Seed zone-level parent locations ───────────────────────────────────────
-- Update existing zones to be parents, then seed bins under them.

-- Zone 1 bins: 6 rows (A-F) × 6 cols (01-06)
DO $$
DECLARE
  z_id INTEGER;
  r TEXT;
  c TEXT;
  bin_name TEXT;
  bin_barcode TEXT;
BEGIN
  -- Ensure Zone 1 parent exists
  INSERT INTO locations (name, zone, description, sort_order)
  VALUES ('Zone 1', 'Zone 1', 'Zone 1 main storage area', 1)
  ON CONFLICT (name) DO UPDATE SET zone = 'Zone 1'
  RETURNING id INTO z_id;

  -- If it already existed, fetch the id
  IF z_id IS NULL THEN
    SELECT id INTO z_id FROM locations WHERE name = 'Zone 1' LIMIT 1;
  END IF;

  -- Generate 6×6 grid
  FOREACH r IN ARRAY ARRAY['A','B','C','D','E','F'] LOOP
    FOREACH c IN ARRAY ARRAY['01','02','03','04','05','06'] LOOP
      bin_name := 'Z1-' || r || '-' || c;
      bin_barcode := 'Z1-' || r || '-' || c;
      INSERT INTO locations (name, zone, row_label, col_label, barcode, bin_type, parent_id, sort_order)
      VALUES (bin_name, 'Zone 1', r, c, bin_barcode, 'SHELF', z_id,
              (ASCII(r) - 64) * 100 + c::integer)
      ON CONFLICT (name) DO NOTHING;
    END LOOP;
  END LOOP;

  -- Ensure Zone 2 parent exists
  INSERT INTO locations (name, zone, description, sort_order)
  VALUES ('Zone 2', 'Zone 2', 'Zone 2 secondary storage area', 2)
  ON CONFLICT (name) DO UPDATE SET zone = 'Zone 2'
  RETURNING id INTO z_id;

  IF z_id IS NULL THEN
    SELECT id INTO z_id FROM locations WHERE name = 'Zone 2' LIMIT 1;
  END IF;

  -- Zone 2: 6×6 grid
  FOREACH r IN ARRAY ARRAY['A','B','C','D','E','F'] LOOP
    FOREACH c IN ARRAY ARRAY['01','02','03','04','05','06'] LOOP
      bin_name := 'Z2-' || r || '-' || c;
      bin_barcode := 'Z2-' || r || '-' || c;
      INSERT INTO locations (name, zone, row_label, col_label, barcode, bin_type, parent_id, sort_order)
      VALUES (bin_name, 'Zone 2', r, c, bin_barcode, 'SHELF', z_id,
              (ASCII(r) - 64) * 100 + c::integer)
      ON CONFLICT (name) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;
