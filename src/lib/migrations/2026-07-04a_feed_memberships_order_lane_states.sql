-- ============================================================================
-- 2026-07-04a: feed_memberships.state CHECK — add the orders_unshipped
-- fulfillment lanes (pending / tested / blocked)
-- ============================================================================
-- Phase 5 of docs/unshipped-dashboard-performance-plan.md. The orders_unshipped
-- projector (src/lib/orders/feed-membership-projection.ts) computes each open
-- order's fulfillment lane in NODE via deriveFulfillmentState (Decision 8 — the
-- lane rule is NEVER re-implemented in SQL) and stores it directly in
-- feed_memberships.state. That lets the EXISTING index
-- idx_feed_memberships_org_feed_state_time
--   (organization_id, feed_key, state, occurred_at DESC, id DESC)
-- serve per-lane counts + keyset pagination with NO new column or index, and
-- makes getFeedState's GROUP BY state == the per-lane breakdown for free.
-- 'done' still marks an order that has LEFT the queue (packed / shipped / label
-- removed); getFeedState already filters `state <> 'done'`.
--
-- Widen (never narrow) the named CHECK, re-affirming the FULL union in one place
-- to avoid the CHECK-redefinition drift the reason_codes_flow_context_chk history
-- warns about. DROP IF EXISTS + ADD is idempotent and safe to re-run.
--
-- Registry mirror updated in the same change: src/lib/surfaces/registry.ts
-- (FEED_MEMBERSHIP_STATES) + the registry.test.ts state-CHECK pin.
--
-- ROLLBACK (only after no row uses a lane value, else the re-ADD fails):
--   ALTER TABLE feed_memberships DROP CONSTRAINT IF EXISTS feed_memberships_state_chk;
--   ALTER TABLE feed_memberships ADD CONSTRAINT feed_memberships_state_chk
--     CHECK (state IN ('active','needs_match','done'));
-- ============================================================================

BEGIN;

ALTER TABLE feed_memberships DROP CONSTRAINT IF EXISTS feed_memberships_state_chk;
ALTER TABLE feed_memberships ADD CONSTRAINT feed_memberships_state_chk
  CHECK (state IN ('active','needs_match','done','pending','tested','blocked'));

COMMIT;
