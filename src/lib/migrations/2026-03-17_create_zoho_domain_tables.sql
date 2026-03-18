CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zoho_item_id TEXT UNIQUE NOT NULL,
  zoho_item_group_id TEXT,
  name TEXT NOT NULL,
  sku TEXT,
  upc TEXT,
  ean TEXT,
  description TEXT,
  item_type TEXT,
  product_type TEXT,
  status TEXT NOT NULL,
  rate NUMERIC(12,4),
  purchase_rate NUMERIC(12,4),
  unit TEXT,
  reorder_level INTEGER,
  initial_stock NUMERIC(12,4),
  tax_id TEXT,
  tax_name TEXT,
  tax_percentage NUMERIC(6,3),
  image_url TEXT,
  quantity_available NUMERIC(12,4),
  quantity_on_hand NUMERIC(12,4),
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  internal_notes TEXT,
  zoho_last_modified TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS items_sku_idx ON items (sku);
CREATE INDEX IF NOT EXISTS items_upc_idx ON items (upc);
CREATE INDEX IF NOT EXISTS items_status_idx ON items (status);
CREATE INDEX IF NOT EXISTS items_zoho_modified_idx ON items (zoho_last_modified);

CREATE TABLE IF NOT EXISTS zoho_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zoho_location_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT FALSE,
  address JSONB DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS item_location_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES zoho_locations(id) ON DELETE CASCADE,
  quantity_available NUMERIC(12,4) NOT NULL DEFAULT 0,
  quantity_on_hand NUMERIC(12,4) NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, location_id)
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zoho_so_id TEXT UNIQUE,
  salesorder_number TEXT,
  reference_number TEXT UNIQUE NOT NULL,
  channel TEXT NOT NULL,
  contact_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  return_status TEXT DEFAULT 'none',
  order_date DATE NOT NULL,
  shipment_date DATE,
  sub_total NUMERIC(12,2),
  tax_total NUMERIC(12,2),
  total NUMERIC(12,2),
  currency_code TEXT DEFAULT 'USD',
  shipping_charge NUMERIC(12,2),
  notes TEXT,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  billing_address JSONB DEFAULT '{}'::jsonb,
  shipping_address JSONB DEFAULT '{}'::jsonb,
  zoho_last_modified TIMESTAMPTZ,
  synced_at TIMESTAMPTZ,
  internal_notes TEXT,
  assigned_to INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS so_reference_idx ON sales_orders (reference_number);
CREATE INDEX IF NOT EXISTS so_channel_idx ON sales_orders (channel);
CREATE INDEX IF NOT EXISTS so_status_idx ON sales_orders (status);
CREATE INDEX IF NOT EXISTS so_order_date_idx ON sales_orders (order_date);

CREATE TABLE IF NOT EXISTS packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zoho_package_id TEXT UNIQUE,
  sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  package_number TEXT,
  status TEXT,
  date DATE,
  notes TEXT,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zoho_shipment_id TEXT UNIQUE,
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  status TEXT,
  date DATE,
  tracking_number TEXT,
  carrier TEXT,
  shipstation_order_id TEXT,
  shipstation_label_url TEXT,
  shipment_id BIGINT REFERENCES shipping_tracking_numbers(id) ON DELETE SET NULL,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zoho_invoice_id TEXT UNIQUE,
  sales_order_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
  invoice_number TEXT,
  status TEXT,
  date DATE,
  due_date DATE,
  total NUMERIC(12,2),
  balance NUMERIC(12,2),
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zoho_credit_note_id TEXT UNIQUE,
  sales_order_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  credit_note_number TEXT,
  status TEXT,
  date DATE,
  total NUMERIC(12,2),
  balance NUMERIC(12,2),
  reason TEXT,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS item_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zoho_adjustment_id TEXT UNIQUE,
  reason TEXT NOT NULL,
  date DATE NOT NULL,
  reference_number TEXT,
  status TEXT DEFAULT 'pending',
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sync_cursors
  ADD COLUMN IF NOT EXISTS full_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS entity_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  body TEXT NOT NULL,
  author_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entity_notes_lookup
  ON entity_notes (entity_type, entity_id);

DROP TABLE IF EXISTS order_tasks;
DROP TABLE IF EXISTS orders_task;
