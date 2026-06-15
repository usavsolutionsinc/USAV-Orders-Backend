-- ============================================================================
-- 2026-06-14d: Realized sale price on orders
-- ============================================================================
-- The "price" column for the orders / fulfillment tracker. Each order line
-- already carries the price it sold for on its platform, so per-platform
-- variation is captured naturally per-order — sale price is a per-transaction
-- fact, NOT a SKU attribute, so it lives here and never on the SKU tables
-- (which can't hold the history of every sale and don't reliably join).
-- Populated at ingestion from each channel's reported amount (eBay/Amazon/Zoho).
--
-- Additive + idempotent.
-- ============================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS sale_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS currency    text DEFAULT 'USD';
