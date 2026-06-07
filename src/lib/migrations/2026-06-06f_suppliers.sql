-- ============================================================================
-- 2026-06-06: suppliers — third-party sourcing vendors (P0)
-- ============================================================================
-- The vendor module. A supplier is any third-party source of hard-to-find
-- parts: an eBay seller, a distributor, a salvage yard, an OEM contact. eBay
-- sellers are auto-created (by ebay_seller_id) the first time we import one of
-- their listings; the rest are entered by hand in the admin editor.
-- See docs/bose-parts-sourcing-engine-plan.md §3.5.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS suppliers (
  id             serial PRIMARY KEY,
  name           text NOT NULL,
  supplier_type  text NOT NULL DEFAULT 'other',       -- ebay_seller|distributor|salvage|oem|marketplace|other
  email          text,
  phone          text,
  url            text,
  ebay_seller_id text,                                 -- set for auto-created eBay sellers
  rating         integer,                              -- 1..5, internal trust score (nullable)
  lead_time_days integer,
  notes          text,
  is_active      boolean NOT NULL DEFAULT true,        -- soft-delete
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_type_chk CHECK (
    supplier_type IN ('ebay_seller','distributor','salvage','oem','marketplace','other')
  ),
  CONSTRAINT suppliers_rating_chk CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
);

-- eBay sellers are deduped/auto-created by seller id; the partial unique index
-- enforces one supplier row per eBay seller without constraining manual rows
-- (which have a NULL ebay_seller_id).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_suppliers_ebay_seller
  ON suppliers (ebay_seller_id) WHERE ebay_seller_id IS NOT NULL;

COMMENT ON TABLE suppliers IS
  'Third-party sourcing vendors (eBay sellers auto-created on import; others entered manually).';

COMMIT;
