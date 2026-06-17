-- ============================================================================
-- 2026-06-17: platform_listings — first-class per-channel listing
-- ============================================================================
-- Ports the USAV_ERP `platform_listing` concept into the Orders Backend. Today
-- a SKU's external presence is a thin mapping (sku_platform_ids: platform_sku /
-- platform_item_id / account_name). That can't represent the channel-specific
-- PRICE, QUANTITY, CONDITION, or per-listing SYNC STATE that a real catalog/ERP
-- needs — so order/inventory reconciliation has nowhere to hang.
--
-- This table is the richer per-channel listing record:
--   • channel pricing (listing_price_cents) + quantity + condition + upc
--   • free-form platform_metadata (eBay category, Amazon bullets, …)
--   • its own outbound sync state (sync_status / last_synced_at / sync_error)
--     and a sync_hash for idempotent skip (see src/lib/integrations/sync-hash.ts)
--   • external_ref_id (ASIN / eBay listing id) + merchant_sku for matching,
--     with sku_catalog_id NULLABLE so an UNRESOLVED listing can be persisted
--     during SKU-matching instead of being dropped (mirrors ERP migration 0025).
--
-- ADDITIVE + IDEMPOTENT. Does not touch sku_platform_ids — that stays the
-- read path until platform_listings reaches parity (dual-read backfill).
--
-- org_id carries the GUC default so a forgotten explicit value still attributes
-- to the current tenant once RLS is forced. All access goes through
-- src/lib/inventory/platform-listings.ts under withTenantConnection/tenantQuery.
--
-- ⚠ RLS ARMED, NOT ENFORCED — same caveat as 2026-06-14b_catalog_rls.sql: the
-- app connects as neondb_owner (rolbypassrls=true) so this grants ZERO isolation
-- on its own. It's correctness scaffolding that joins the enforcement set once
-- the non-BYPASSRLS app_tenant role is live (Phase E). Do NOT FORCE here.
-- ============================================================================

CREATE TABLE IF NOT EXISTS platform_listings (
  id                   bigserial PRIMARY KEY,
  organization_id      uuid NOT NULL
                         DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  -- NULLABLE: an unresolved listing (seen on a channel but not yet matched to a
  -- catalog SKU) is still worth persisting so matching is a workflow, not a drop.
  sku_catalog_id       integer REFERENCES sku_catalog(id) ON DELETE SET NULL,
  platform             text NOT NULL,                  -- 'ebay' | 'amazon' | 'square' | 'ecwid' | …
  account_name         text,                           -- which connected account (multi-account orgs)
  external_ref_id      text,                           -- ASIN / eBay listing id / channel listing id
  merchant_sku         text,                           -- fallback marketplace SKU when no external_ref_id
  listed_name          text,
  listed_description   text,
  listing_price_cents  integer,                        -- channel-specific price (cents, repo convention)
  listing_quantity     integer,
  listing_condition    text,                           -- channel condition grade (NEW / USED_GOOD / …)
  upc                  text,
  platform_metadata    jsonb,                          -- channel-specific fields (category, bullets, …)
  sync_status          text NOT NULL DEFAULT 'PENDING',-- PENDING | SYNCED | ERROR
  sync_hash            text,                           -- sha256 of last-pushed payload (idempotent skip)
  last_synced_at       timestamptz,
  sync_error           text,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- One listing per (org, platform, external_ref_id) when a channel id exists;
-- partial so many unresolved rows (NULL external_ref_id) can coexist.
CREATE UNIQUE INDEX IF NOT EXISTS ux_platform_listings_org_platform_ref
  ON platform_listings (organization_id, platform, external_ref_id)
  WHERE external_ref_id IS NOT NULL;

-- Non-unique: resolve order lines / merchant SKUs to a listing.
CREATE INDEX IF NOT EXISTS idx_platform_listings_org_platform_merchant
  ON platform_listings (organization_id, platform, merchant_sku);

CREATE INDEX IF NOT EXISTS idx_platform_listings_catalog
  ON platform_listings (sku_catalog_id);

CREATE INDEX IF NOT EXISTS idx_platform_listings_org_sync_status
  ON platform_listings (organization_id, sync_status);

-- ── Arm RLS (NOT enforced; see header caveat) ──────────────────────────────
ALTER TABLE platform_listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_listings_tenant_isolation ON platform_listings;
CREATE POLICY platform_listings_tenant_isolation ON platform_listings
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
