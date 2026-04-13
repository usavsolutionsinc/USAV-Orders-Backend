-- Local Pickup Orders: header table grouping line items into a single pickup session
CREATE TABLE IF NOT EXISTS local_pickup_orders (
  id              SERIAL PRIMARY KEY,
  pickup_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  customer_name   TEXT,
  status          TEXT NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'COMPLETED', 'VOIDED')),
  notes           TEXT,
  created_by      INTEGER REFERENCES staff(id),
  completed_at    TIMESTAMPTZ,
  voided_by       INTEGER REFERENCES staff(id),
  voided_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lpo_pickup_date ON local_pickup_orders (pickup_date DESC);
CREATE INDEX IF NOT EXISTS idx_lpo_status ON local_pickup_orders (status);

-- Local Pickup Order Items: many line items per order
CREATE TABLE IF NOT EXISTS local_pickup_order_items (
  id              SERIAL PRIMARY KEY,
  order_id        INTEGER NOT NULL REFERENCES local_pickup_orders(id) ON DELETE CASCADE,
  receiving_id    INTEGER REFERENCES receiving(id),
  sku             TEXT NOT NULL,
  product_title   TEXT,
  image_url       TEXT,
  quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  condition_grade TEXT NOT NULL DEFAULT 'USED_A'
                    CHECK (condition_grade IN ('BRAND_NEW', 'USED_A', 'USED_B', 'USED_C', 'PARTS')),
  parts_status    TEXT NOT NULL DEFAULT 'COMPLETE'
                    CHECK (parts_status IN ('COMPLETE', 'MISSING_PARTS')),
  missing_parts_note TEXT,
  condition_note  TEXT,
  total_price     NUMERIC(12,2) DEFAULT 0 CHECK (total_price >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lpoi_order_id ON local_pickup_order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_lpoi_sku ON local_pickup_order_items (sku);
