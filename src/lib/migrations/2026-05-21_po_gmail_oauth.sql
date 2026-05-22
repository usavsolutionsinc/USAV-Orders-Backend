-- Allow a second OAuth provider in google_oauth_tokens: 'po_gmail'.
-- The PO mailbox is a separate Gmail account whose refresh token we use
-- to scan incoming purchase-order emails. Same 3-legged OAuth pattern as
-- google_photos, same table — just a new provider value.
--
-- Also adds per-row needs_reconnect flags so we can surface a broken
-- token in the admin UI without creating one settings table per provider.

BEGIN;

ALTER TABLE google_oauth_tokens
  DROP CONSTRAINT IF EXISTS chk_google_oauth_provider;

ALTER TABLE google_oauth_tokens
  ADD CONSTRAINT chk_google_oauth_provider
  CHECK (provider IN ('google_photos', 'po_gmail'));

ALTER TABLE google_oauth_tokens
  ADD COLUMN IF NOT EXISTS needs_reconnect        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS needs_reconnect_reason TEXT;

COMMIT;
