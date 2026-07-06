-- ============================================================================
-- 2026-07-06a: entity_search_docs — tracking_number + carrier facet columns
-- ============================================================================
-- docs/global-header-search-best-in-class-plan.md Phase E (Shopify-grade order
-- row). The search doc already carries `status / condition_grade /
-- source_platform / happened_at` as REAL facet columns (not jsonb — see
-- 2026-07-03d). This adds two more so the ORDER (and RECEIVING) rows can render
-- a carrier + last-4 tracking chip via the CopyChip SoT, without a second fetch
-- on the keystroke path.
--
-- ADDITIVE + NULLABLE + IDEMPOTENT. No new discriminator, no RLS change (the
-- table is already FORCE-RLS'd tenant-from-birth). No enqueue-trigger change:
-- order tracking lives on a join table (shipping_tracking_numbers) — the same
-- documented KNOWN GAP as 2026-07-03d (a join-table-only change surfaces on the
-- next parent write or a backfill sweep), so watching new columns here would be
-- moot. The builder (build-search-text.ts buildOrderDoc/buildReceivingDoc) and
-- the worker upsert (search-outbox-worker.ts) populate these; the retrieval
-- SELECTs (hybrid-retrieval.ts) read them through to SearchHit.facets.
--
-- BACKFILL: enqueue existing ORDER + RECEIVING docs (the only two builders that
-- populate the new columns) so the worker refreshes them on its next drain.
-- Bounded to those two types to avoid re-embedding the whole corpus; deduped
-- against the pending partial unique.
--
-- ROLLBACK:
--   ALTER TABLE entity_search_docs DROP COLUMN IF EXISTS tracking_number, DROP COLUMN IF EXISTS carrier;
--   (the row simply stops rendering the chip — the facets go unread)
-- ============================================================================

BEGIN;

ALTER TABLE entity_search_docs ADD COLUMN IF NOT EXISTS tracking_number TEXT;
ALTER TABLE entity_search_docs ADD COLUMN IF NOT EXISTS carrier         TEXT;

-- Refresh the two entity types whose builders now emit these facets. The
-- worker recomputes ALL doc fields on drain, so a plain re-enqueue backfills
-- tracking_number/carrier. ON CONFLICT matches the pending-claim partial unique
-- (2026-07-04a) so an in-flight or queued row is never double-enqueued.
INSERT INTO entity_search_outbox (organization_id, entity_type, entity_id)
SELECT organization_id, entity_type, entity_id
FROM entity_search_docs
WHERE entity_type IN ('ORDER', 'RECEIVING')
ON CONFLICT (organization_id, entity_type, entity_id)
  WHERE processed_at IS NULL AND claimed_at IS NULL
DO NOTHING;

COMMIT;
