-- Receiving — store the filed Zendesk ticket number on the record so it shows
-- back on the line/carton (parity with repair_service.ticket_number).
--
-- Until now a claim filed from the receiving workspace or the testing page
-- (both POST /api/receiving/zendesk-claim against a receiving_lines row) wrote
-- the ticket→entity link to ticket_links but left no human-visible ticket
-- number on the row — the LineEditPanel "Zendesk" field was localStorage-only.
--
-- These columns hold the display value (stored as "#<id>"). The claim route
-- writes them on submission; the receiving-lines PATCH lets operators edit them.
-- ticket_links / external_id remain the authoritative mapping for the support
-- console's photo resolution.

BEGIN;

ALTER TABLE receiving_lines
  ADD COLUMN IF NOT EXISTS zendesk_ticket TEXT;

ALTER TABLE receiving
  ADD COLUMN IF NOT EXISTS zendesk_ticket TEXT;

CREATE INDEX IF NOT EXISTS idx_receiving_lines_zendesk_ticket
  ON receiving_lines (zendesk_ticket)
  WHERE zendesk_ticket IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receiving_zendesk_ticket
  ON receiving (zendesk_ticket)
  WHERE zendesk_ticket IS NOT NULL;

COMMIT;
