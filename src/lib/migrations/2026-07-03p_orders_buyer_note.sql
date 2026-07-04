-- ============================================================================
-- 2026-07-03p: orders.buyer_note — persist the marketplace buyer checkout note
-- in the order mirror (Phase 1 of docs/todo/universal-feed-polymorphic-plan.md,
-- §2.3 mirror-derivation standard / §2.3 dated correction)
-- ============================================================================
-- The eBay Fulfillment getOrders response carries `buyerCheckoutNotes` on
-- every order, but the sync (src/lib/ebay/sync.ts,
-- createOrUpdateOrderFromEbayTracking) dropped it — and `orders` had no raw
-- payload column to recover it from. Per §2.3, signals project from the LOCAL
-- MIRROR, never from a connector side-effect, so the note must land in the
-- mirror first. This is that minimal mirror extension: one nullable TEXT
-- column, written by the sync (COALESCE — an existing note is never
-- clobbered), read by the buyer-note derivation module
-- (src/lib/surfaces/buyer-note-derivation.ts), which emits
-- entity_signals(signal_kind='buyer_note') with sha-based source_ref
-- idempotency. Raw text only — no interpretation at ingest (§2.3 point 6).
--
-- Safety gating: additive nullable column on an existing tenant table; no
-- backfill, no default, no new index (`orders` has no updated_at — the
-- derivation sweep scans the newest N rows by id with an org predicate, and
-- source_ref idempotency makes over-scanning free). Writers unchanged except
-- the eBay sync gaining one column.
--
-- DEPLOY ORDER: apply this migration BEFORE (or with) the code deploy that
-- ships the sync change — the eBay upsert references buyer_note
-- unconditionally, so code-first would break order creation until applied.
--
-- ROLLBACK:
--   ALTER TABLE orders DROP COLUMN IF EXISTS buyer_note;
-- ============================================================================

BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_note TEXT;

COMMENT ON COLUMN orders.buyer_note IS
  'Marketplace buyer checkout note/message (eBay buyerCheckoutNotes), mirrored raw by the order sync. Projected into entity_signals (buyer_note) by src/lib/surfaces/buyer-note-derivation.ts — never interpreted at ingest.';

COMMIT;
