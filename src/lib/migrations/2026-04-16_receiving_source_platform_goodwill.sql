-- Allow Goodwill as a carton-level source_platform on receiving.

BEGIN;

ALTER TABLE receiving DROP CONSTRAINT IF EXISTS receiving_source_platform_chk;

ALTER TABLE receiving
  ADD CONSTRAINT receiving_source_platform_chk
  CHECK (
    source_platform IS NULL
    OR source_platform IN (
      'zoho',
      'ebay',
      'amazon',
      'aliexpress',
      'walmart',
      'other',
      'goodwill'
    )
  );

COMMIT;
