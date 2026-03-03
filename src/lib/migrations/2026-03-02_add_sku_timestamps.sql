ALTER TABLE sku
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

UPDATE sku
SET created_at = COALESCE(created_at, NOW()),
    updated_at = COALESCE(updated_at, NOW())
WHERE created_at IS NULL
   OR updated_at IS NULL;

ALTER TABLE sku
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

CREATE OR REPLACE FUNCTION set_sku_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sku_set_updated_at ON sku;

CREATE TRIGGER trg_sku_set_updated_at
BEFORE UPDATE ON sku
FOR EACH ROW
EXECUTE FUNCTION set_sku_updated_at();
