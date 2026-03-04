CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  order_id TEXT,
  customer_name TEXT,
  shipping_address_1 TEXT,
  shipping_address_2 TEXT,
  shipping_city TEXT,
  shipping_state TEXT,
  shipping_postal_code TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sku (
  id SERIAL PRIMARY KEY,
  static_sku TEXT,
  serial_number TEXT,
  shipping_tracking_number TEXT,
  notes TEXT,
  location TEXT,
  date_time TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS order_id TEXT,
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address_1 TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address_2 TEXT,
  ADD COLUMN IF NOT EXISTS shipping_city TEXT,
  ADD COLUMN IF NOT EXISTS shipping_state TEXT,
  ADD COLUMN IF NOT EXISTS shipping_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

UPDATE customers
SET created_at = CURRENT_TIMESTAMP
WHERE created_at IS NULL;

ALTER TABLE customers
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE customers
  DROP COLUMN IF EXISTS shipping_country;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sku'
      AND column_name = 'date_time'
      AND data_type IN ('text', 'character varying', 'character')
  ) THEN
    ALTER TABLE sku
      ALTER COLUMN date_time TYPE TIMESTAMP
      USING CASE
        WHEN date_time IS NULL OR BTRIM(date_time) = '' THEN NULL
        WHEN date_time ~ '^\d{4}-\d{2}-\d{2}' THEN date_time::timestamp
        WHEN date_time ~ '^\d{1,2}/\d{1,2}/\d{4},' THEN to_timestamp(date_time, 'MM/DD/YYYY, HH24:MI:SS')
        WHEN date_time ~ '^\d{1,2}/\d{1,2}/\d{4} ' THEN to_timestamp(date_time, 'MM/DD/YYYY HH24:MI:SS')
        WHEN date_time ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_timestamp(date_time, 'MM/DD/YYYY')
        ELSE NULL
      END;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sku'
      AND column_name = 'date_time'
  ) THEN
    ALTER TABLE sku
      ADD COLUMN date_time TIMESTAMP;
  END IF;
END $$;
