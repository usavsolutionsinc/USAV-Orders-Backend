-- ============================================================================
-- 2026-06-06: allow receiving.source = 'sourcing_import' (Bose Sourcing Engine)
-- ============================================================================
-- The candidate-import flow (/api/sourcing/candidates/[id]/import) creates a
-- receiving header for the inbound secondary-market unit with
-- source='sourcing_import', source_platform='ebay'. The existing
-- receiving_source_chk only permitted zoho_po|unmatched|local_pickup, so this
-- additive migration widens it.
--
-- Additive + idempotent. Existing rows are unaffected (their source values are
-- all still in the allowed set). See docs/bose-sourcing-migration-and-endpoint-
-- integration.md §3 and docs/bose-parts-sourcing-engine-plan.md §5.
-- ============================================================================

BEGIN;

ALTER TABLE receiving DROP CONSTRAINT IF EXISTS receiving_source_chk;
ALTER TABLE receiving
  ADD CONSTRAINT receiving_source_chk
  CHECK (source IN ('zoho_po', 'unmatched', 'local_pickup', 'sourcing_import'));

COMMIT;
