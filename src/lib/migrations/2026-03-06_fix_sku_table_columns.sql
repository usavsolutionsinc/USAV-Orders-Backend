-- Ensure sku table exists with the full schema
CREATE TABLE IF NOT EXISTS sku (
  id                      SERIAL PRIMARY KEY,
  static_sku              TEXT,
  serial_number           TEXT,
  shipping_tracking_number TEXT,
  notes                   TEXT,
  location                TEXT,
  date_time               TIMESTAMP,
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP DEFAULT now()
);

-- Idempotently add any missing columns (safe to run multiple times)
ALTER TABLE sku ADD COLUMN IF NOT EXISTS shipping_tracking_number TEXT;
ALTER TABLE sku ADD COLUMN IF NOT EXISTS notes                    TEXT;
ALTER TABLE sku ADD COLUMN IF NOT EXISTS location                 TEXT;
ALTER TABLE sku ADD COLUMN IF NOT EXISTS date_time                TIMESTAMP;
ALTER TABLE sku ADD COLUMN IF NOT EXISTS created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE sku ADD COLUMN IF NOT EXISTS updated_at               TIMESTAMP DEFAULT now();

-- Backfill nulls so NOT NULL can be set safely
UPDATE sku SET created_at = now() WHERE created_at IS NULL;
UPDATE sku SET updated_at = now() WHERE updated_at IS NULL;

-- Set column defaults if not already set
ALTER TABLE sku ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE sku ALTER COLUMN updated_at SET DEFAULT now();

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION set_sku_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sku_updated_at ON sku;
CREATE TRIGGER trg_sku_updated_at
BEFORE UPDATE ON sku
FOR EACH ROW EXECUTE FUNCTION set_sku_updated_at();
