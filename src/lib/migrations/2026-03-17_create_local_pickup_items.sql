CREATE TABLE IF NOT EXISTS local_pickup_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receiving_id INTEGER NOT NULL UNIQUE REFERENCES receiving(id) ON DELETE CASCADE,
  pickup_date DATE NOT NULL DEFAULT CURRENT_DATE,
  product_title TEXT,
  sku TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  parts_status TEXT NOT NULL DEFAULT 'COMPLETE',
  missing_parts_note TEXT,
  receiving_grade TEXT,
  condition_note TEXT,
  offer_price NUMERIC(12,2),
  total NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS local_pickup_items_pickup_date_idx
  ON local_pickup_items (pickup_date);

CREATE INDEX IF NOT EXISTS local_pickup_items_parts_status_idx
  ON local_pickup_items (parts_status);
