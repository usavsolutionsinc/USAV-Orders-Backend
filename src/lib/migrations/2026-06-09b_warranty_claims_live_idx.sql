-- ============================================================================
-- 2026-06-09b: partial index for live (non-deleted) warranty claims
-- ============================================================================
-- 2026-06-09_warranty_zendesk_link.sql introduced soft delete; every warranty
-- read now leads with `deleted_at IS NULL` (list, reports, coverage, and the
-- two clock-sweep cron queries). This index keeps the dominant read — live
-- rows filtered by status, newest first — index-driven as the table grows,
-- instead of rechecking deleted_at on the heap per idx_warranty_claims_status
-- match.
--
-- Additive + idempotent.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_warranty_claims_live_status
  ON warranty_claims (status, created_at DESC)
  WHERE deleted_at IS NULL;
