-- Receiving source: add 'local_pickup' as a first-class value.
--
-- `receiving.source` was constrained to ('zoho_po', 'unmatched') by
-- 2026-04-14_receiving_scan_split.sql. Local-pickup intakes
-- (/api/receiving-entry with carrier='LOCAL', detail in local_pickup_items)
-- are neither a Zoho PO nor an unidentified package — tagging them
-- 'unmatched' would surface every pickup in the Unfound queue
-- (v_unfound_queue Branch 1 = receiving WHERE source='unmatched' with no
-- linked lines, which a pickup carton always is), and 'zoho_po' would
-- masquerade as a matched PO. Give pickups their own source value so they
-- stay out of both surfaces.
--
-- Idempotent — safe to re-run (DROP IF EXISTS then re-ADD with the wider set).

BEGIN;

ALTER TABLE receiving
  DROP CONSTRAINT IF EXISTS receiving_source_chk;

ALTER TABLE receiving
  ADD CONSTRAINT receiving_source_chk
  CHECK (source IN ('zoho_po', 'unmatched', 'local_pickup'));

COMMIT;
