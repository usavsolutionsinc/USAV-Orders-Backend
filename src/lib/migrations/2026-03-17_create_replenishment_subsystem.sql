CREATE TYPE replenishment_status AS ENUM (
  'detected',
  'pending_review',
  'planned_for_po',
  'po_created',
  'waiting_for_receipt',
  'fulfilled',
  'cancelled'
);

CREATE TABLE IF NOT EXISTS replenishment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id),
  zoho_item_id TEXT NOT NULL,
  sku TEXT,
  item_name TEXT NOT NULL,
  quantity_needed NUMERIC(12, 2) NOT NULL DEFAULT 0,
  zoho_quantity_available NUMERIC(12, 2),
  zoho_quantity_on_hand NUMERIC(12, 2),
  zoho_incoming_quantity NUMERIC(12, 2) DEFAULT 0,
  quantity_to_order NUMERIC(12, 2) GENERATED ALWAYS AS (
    GREATEST(0, quantity_needed - COALESCE(zoho_incoming_quantity, 0) - COALESCE(zoho_quantity_available, 0))
  ) STORED,
  vendor_zoho_contact_id TEXT,
  vendor_name TEXT,
  unit_cost NUMERIC(12, 4),
  status replenishment_status NOT NULL DEFAULT 'detected',
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  zoho_po_id TEXT UNIQUE,
  zoho_po_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rr_item_id_idx ON replenishment_requests (item_id);
CREATE INDEX IF NOT EXISTS rr_status_idx ON replenishment_requests (status);
CREATE INDEX IF NOT EXISTS rr_zoho_item_id_idx ON replenishment_requests (zoho_item_id);
CREATE INDEX IF NOT EXISTS rr_zoho_po_id_idx ON replenishment_requests (zoho_po_id);

CREATE TABLE IF NOT EXISTS replenishment_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  replenishment_request_id UUID NOT NULL REFERENCES replenishment_requests(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_line_id TEXT,
  channel_order_id TEXT,
  quantity_needed NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (replenishment_request_id, order_id)
);

CREATE INDEX IF NOT EXISTS rol_replenishment_idx ON replenishment_order_lines (replenishment_request_id);
CREATE INDEX IF NOT EXISTS rol_order_idx ON replenishment_order_lines (order_id);

CREATE TABLE IF NOT EXISTS item_stock_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zoho_item_id TEXT UNIQUE NOT NULL,
  item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  quantity_available NUMERIC(12, 2) NOT NULL DEFAULT 0,
  quantity_on_hand NUMERIC(12, 2) NOT NULL DEFAULT 0,
  incoming_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0,
  open_po_ids TEXT[],
  sync_error TEXT,
  last_synced_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS isc_item_id_idx ON item_stock_cache (item_id);

CREATE TABLE IF NOT EXISTS replenishment_status_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  replenishment_request_id UUID NOT NULL REFERENCES replenishment_requests(id) ON DELETE CASCADE,
  from_status replenishment_status,
  to_status replenishment_status NOT NULL,
  changed_by TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rsl_request_idx ON replenishment_status_log (replenishment_request_id);
