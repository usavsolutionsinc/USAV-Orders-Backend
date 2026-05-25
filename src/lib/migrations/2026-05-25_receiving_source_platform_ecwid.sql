-- Allow 'ecwid' as a carton-level source_platform on receiving.
-- Needed for the "Link repair service" flow in the receiving workspace,
-- which writes source_platform='ecwid' when an unmatched carton is paired
-- with a recent Ecwid order containing a -RS (repair service) SKU.
-- Mirrors 2026-04-16_receiving_source_platform_goodwill.sql.

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
      'goodwill',
      'ecwid'
    )
  );
