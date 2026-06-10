-- ============================================================================
-- 2026-06-09: warranty_claims ↔ Zendesk link + soft delete
-- ============================================================================
-- Round-trips a warranty claim with a Zendesk ticket (create ticket from the
-- claim, post replies, pull the comment thread). The numeric ticket id lives
-- on the claim for cheap joins/display; the universal ticket_links row is
-- still written at creation time so the support workspace resolves the claim
-- the same way it resolves receiving claims (see src/lib/zendesk-links.ts).
--
-- deleted_at backs DELETE /api/warranty/claims/[id] + the bulk variant as a
-- SOFT delete: claims carry an audit/event trail and FK out to RMA / repair,
-- so rows are tombstoned, never dropped. All reads filter deleted_at IS NULL.
--
-- Additive + idempotent.
-- ============================================================================

ALTER TABLE warranty_claims
  ADD COLUMN IF NOT EXISTS zendesk_ticket_id BIGINT,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Reverse lookup (ticket → claim) only ever scans linked rows.
CREATE INDEX IF NOT EXISTS idx_warranty_claims_zendesk_ticket
  ON warranty_claims (zendesk_ticket_id)
  WHERE zendesk_ticket_id IS NOT NULL;
