-- ============================================================================
-- 2026-06-14c: Amazon order import support (Phase 2)
-- ============================================================================
-- Amazon orders land in the operational `orders` table (visible in the
-- dashboard, like eBay). `fulfillment_channel` distinguishes Amazon-fulfilled
-- (AFN/FBA) from merchant-fulfilled (MFN). /api/orders excludes AFN rows from
-- the unshipped to-do list so FBA orders are read-only records that don't
-- pollute the pack/tech work surfaces.
--
-- The (account_source, order_id) uniqueness used for idempotent upserts is the
-- existing idx_orders_unique_account_order — no new constraint needed.
--
-- Additive + idempotent.
-- ============================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fulfillment_channel text;
