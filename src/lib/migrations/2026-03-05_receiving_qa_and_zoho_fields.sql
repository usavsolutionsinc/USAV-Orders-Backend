-- Receiving + QA + Zoho alignment
-- Adds required enums, receiving columns, receiving_lines table, and repair_service.repaired_by.

DO $$
BEGIN
  CREATE TYPE qa_status_enum AS ENUM (
    'PENDING',
    'PASSED',
    'FAILED_DAMAGED',
    'FAILED_INCOMPLETE',
    'FAILED_FUNCTIONAL',
    'HOLD'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE disposition_enum AS ENUM ('ACCEPT', 'HOLD', 'RTV', 'SCRAP', 'REWORK');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE condition_grade_enum AS ENUM ('BRAND_NEW', 'USED_A', 'USED_B', 'USED_C', 'PARTS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE return_platform_enum AS ENUM ('AMZ', 'EBAY_DRAGONH', 'EBAY_USAV', 'EBAY_MK', 'FBA', 'WALMART', 'ECWID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE target_channel_enum AS ENUM ('ORDERS', 'FBA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE receiving
  ADD COLUMN IF NOT EXISTS receiving_date_time TIMESTAMP,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS received_by INTEGER REFERENCES staff(id),
  ADD COLUMN IF NOT EXISTS unboxed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS unboxed_by INTEGER REFERENCES staff(id),
  ADD COLUMN IF NOT EXISTS qa_status qa_status_enum NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS disposition_code disposition_enum NOT NULL DEFAULT 'HOLD',
  ADD COLUMN IF NOT EXISTS condition_grade condition_grade_enum NOT NULL DEFAULT 'BRAND_NEW',
  ADD COLUMN IF NOT EXISTS is_return BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS return_platform return_platform_enum,
  ADD COLUMN IF NOT EXISTS return_reason TEXT,
  ADD COLUMN IF NOT EXISTS needs_test BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS assigned_tech_id INTEGER REFERENCES staff(id),
  ADD COLUMN IF NOT EXISTS target_channel target_channel_enum,
  ADD COLUMN IF NOT EXISTS zoho_purchase_receive_id TEXT,
  ADD COLUMN IF NOT EXISTS zoho_warehouse_id TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Keep legacy rows valid by backfilling receiving_date_time from date_time when present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'receiving'
      AND column_name = 'date_time'
  ) THEN
    EXECUTE $sql$
      UPDATE receiving
      SET receiving_date_time = COALESCE(
        receiving_date_time,
        NULLIF(date_time, '')::timestamp
      )
      WHERE receiving_date_time IS NULL
        AND date_time IS NOT NULL
        AND date_time <> ''
    $sql$;
  END IF;
END $$;

ALTER TABLE receiving
  ALTER COLUMN receiving_date_time SET DEFAULT NOW();

UPDATE receiving
SET receiving_date_time = NOW()
WHERE receiving_date_time IS NULL;

ALTER TABLE receiving
  ALTER COLUMN receiving_date_time SET NOT NULL;

CREATE TABLE IF NOT EXISTS receiving_lines (
  id SERIAL PRIMARY KEY,
  receiving_id INTEGER NOT NULL REFERENCES receiving(id) ON DELETE CASCADE,
  zoho_item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  qa_status qa_status_enum NOT NULL DEFAULT 'PENDING',
  disposition_code disposition_enum NOT NULL DEFAULT 'HOLD',
  condition_grade condition_grade_enum NOT NULL DEFAULT 'BRAND_NEW',
  disposition_audit JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_receiving_lines_receiving_id ON receiving_lines(receiving_id);
CREATE INDEX IF NOT EXISTS idx_receiving_zoho_purchase_receive_id ON receiving(zoho_purchase_receive_id);
CREATE INDEX IF NOT EXISTS idx_receiving_qa_status ON receiving(qa_status);
CREATE INDEX IF NOT EXISTS idx_receiving_is_return ON receiving(is_return);

ALTER TABLE repair_service
  ADD COLUMN IF NOT EXISTS repaired_by INTEGER REFERENCES staff(id);
