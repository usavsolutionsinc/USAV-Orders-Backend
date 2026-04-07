-- Walk-in sales: local mirror of Square transactions for fast search, history, and custom receipts
CREATE TABLE IF NOT EXISTS square_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  square_order_id TEXT UNIQUE NOT NULL,
  square_payment_id TEXT,
  square_customer_id TEXT,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  line_items JSONB NOT NULL DEFAULT '[]',
  subtotal INTEGER,            -- cents
  tax INTEGER,                 -- cents
  total INTEGER,               -- cents
  discount INTEGER DEFAULT 0,  -- cents
  status TEXT DEFAULT 'completed',
  payment_method TEXT,         -- CARD, CASH, OTHER
  receipt_url TEXT,
  order_source TEXT DEFAULT 'walk_in_sale',  -- 'walk_in_sale' | 'repair_payment'
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  synced_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sq_tx_order_id ON square_transactions(square_order_id);
CREATE INDEX IF NOT EXISTS idx_sq_tx_customer_phone ON square_transactions(customer_phone) WHERE customer_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sq_tx_created_at ON square_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sq_tx_status ON square_transactions(status);
CREATE INDEX IF NOT EXISTS idx_sq_tx_order_source ON square_transactions(order_source);
