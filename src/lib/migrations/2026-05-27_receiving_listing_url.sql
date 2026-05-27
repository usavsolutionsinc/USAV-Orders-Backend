-- Persist the carton-level listing URL on the receiving row so the testing
-- workspace (and any other browser/device) can read it without re-pinging
-- Zoho. Previously the URL only lived in localStorage scratch keyed by
-- receiving_id, so cross-device tooling (e.g. /tech?view=testing) never saw it.

ALTER TABLE receiving
  ADD COLUMN IF NOT EXISTS listing_url TEXT;

COMMENT ON COLUMN receiving.listing_url IS
  'Carton-level marketplace listing URL (eBay/Amazon/etc). Sourced from the Zoho PO notes parser or operator input on receiving; read by receiving + tech testing UIs.';
