-- Per-shipment source platform override (Zoho / eBay / Amazon / AliExpress / …).
-- Stored on `receiving` because platform is carton-level, not line-level.
-- NULL means "derive default" (typically 'zoho' for matched POs, 'unmatched' stays blank).

BEGIN;

ALTER TABLE receiving
  ADD COLUMN IF NOT EXISTS source_platform TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'receiving_source_platform_chk'
  ) THEN
    ALTER TABLE receiving
      ADD CONSTRAINT receiving_source_platform_chk
      CHECK (
        source_platform IS NULL
        OR source_platform IN ('zoho', 'ebay', 'amazon', 'aliexpress', 'walmart', 'other')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_receiving_source_platform
  ON receiving(source_platform)
  WHERE source_platform IS NOT NULL;

COMMIT;
