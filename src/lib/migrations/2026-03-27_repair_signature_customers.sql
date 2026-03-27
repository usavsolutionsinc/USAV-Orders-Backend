-- Migration: Repair service digital signature + customer FK linking
-- 1. Add entity_type/entity_id to customers for polymorphic linking
-- 2. Add customer_id FK to repair_service
-- 3. Create documents table (generic, scalable)

BEGIN;

-- 1. Customers: polymorphic entity linking
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id   INTEGER;

CREATE INDEX IF NOT EXISTS idx_customers_entity
  ON customers(entity_type, entity_id)
  WHERE entity_type IS NOT NULL;

-- 2. Repair service: FK to customers
ALTER TABLE repair_service
  ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_repair_service_customer_id
  ON repair_service(customer_id)
  WHERE customer_id IS NOT NULL;

-- 3. Documents table (generic — works for repair agreements, pickup forms, etc.)
CREATE TABLE IF NOT EXISTS documents (
  id            SERIAL PRIMARY KEY,
  entity_type   TEXT NOT NULL,                  -- 'REPAIR', 'ORDER', etc.
  entity_id     INTEGER NOT NULL,               -- FK to the entity
  document_type TEXT NOT NULL DEFAULT 'intake_agreement',  -- 'intake_agreement', 'pickup_agreement', etc.
  signature_url TEXT,                            -- Vercel Blob URL for PNG signature
  signer_name   TEXT,
  signed_at     TIMESTAMPTZ,
  document_data JSONB NOT NULL DEFAULT '{}',     -- Snapshot of document content at time of signing
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_entity
  ON documents(entity_type, entity_id);

COMMIT;
