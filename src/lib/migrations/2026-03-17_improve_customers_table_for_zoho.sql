-- Improve the existing customers table in place instead of replacing it with a
-- separate contacts table. This keeps orders.customer_id compatible while
-- making the row shape usable for future Zoho contact sync.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS zoho_contact_id TEXT,
  ADD COLUMN IF NOT EXISTS contact_type TEXT NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS mobile TEXT,
  ADD COLUMN IF NOT EXISTS shipping_country TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS billing_address JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS shipping_address JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS currency_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms INTEGER,
  ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS channel_refs JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS internal_notes TEXT,
  ADD COLUMN IF NOT EXISTS zoho_last_modified TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE customers
SET display_name = COALESCE(NULLIF(display_name, ''), NULLIF(customer_name, ''))
WHERE display_name IS NULL;

UPDATE customers
SET shipping_address = jsonb_strip_nulls(jsonb_build_object(
  'address_1', NULLIF(shipping_address_1, ''),
  'address_2', NULLIF(shipping_address_2, ''),
  'city', NULLIF(shipping_city, ''),
  'state', NULLIF(shipping_state, ''),
  'postal_code', NULLIF(shipping_postal_code, ''),
  'country', NULLIF(shipping_country, '')
))
WHERE shipping_address = '{}'::jsonb
   OR shipping_address IS NULL;

UPDATE customers
SET synced_at = COALESCE(synced_at, created_at),
    updated_at = COALESCE(updated_at, created_at, NOW());

CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_zoho_contact_id
  ON customers(zoho_contact_id)
  WHERE zoho_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_order_id
  ON customers(order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_email
  ON customers(email)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_status
  ON customers(status);

CREATE INDEX IF NOT EXISTS idx_customers_zoho_last_modified
  ON customers(zoho_last_modified)
  WHERE zoho_last_modified IS NOT NULL;
