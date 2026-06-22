-- ============================================================================
-- 2026-06-21: serial_unit_listings — per-UNIT listing fact (engine Phase 1.4)
-- ============================================================================
-- UNIFIED-ENGINE-MASTER-PLAN §1.4 wires the dormant fulfillment tail. A serial
-- unit that passes test POOLS at the `list_ebay` graph node because nothing in
-- the app ever marks a *unit* listed: `platform_listings` is SKU-level (keyed on
-- sku_catalog_id) and cannot represent "this physical unit went live", so the
-- `listed` engine tap had nowhere to hang.
--
-- This table is that missing per-unit fact: one row per (org, serial unit,
-- platform) recording the unit went live on a sales channel, with the external
-- listing id when known. It is a SEPARATE AXIS from serial_units.current_status —
-- LISTED is intentionally NOT a serial_status_enum value (DISCOVERY §3); the
-- lifecycle status is unchanged, only the engine graph position advances
-- (list_ebay → pack). Written by src/lib/inventory/markUnitListed.ts, which the
-- /api/serial-units/[id]/list route follows with tapWorkflow('listed').
--
-- ADDITIVE + IDEMPOTENT. Touches nothing existing.
--
-- org_id carries the GUC default so a forgotten explicit value still attributes
-- to the current tenant once RLS is forced. All access goes through
-- markUnitListed() under withTenantTransaction.
--
-- ⚠ RLS ARMED, NOT ENFORCED — same caveat as 2026-06-17_platform_listings.sql:
-- the app connects as neondb_owner (rolbypassrls=true), so this grants ZERO
-- isolation on its own. It is correctness scaffolding that joins the enforcement
-- set once the non-BYPASSRLS app_tenant role is live (Phase E). Do NOT FORCE here.
-- ============================================================================

CREATE TABLE IF NOT EXISTS serial_unit_listings (
  id                   bigserial PRIMARY KEY,
  organization_id      uuid NOT NULL
                         DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  serial_unit_id       bigint NOT NULL REFERENCES serial_units(id) ON DELETE CASCADE,
  sku                  text,                            -- denormalized from serial_units at list time
  platform             text NOT NULL DEFAULT 'ebay',    -- 'ebay' | 'amazon' | 'square' | …
  external_ref_id      text,                            -- channel listing/offer id (eBay listing id, ASIN, …) when known
  listing_price_cents  integer,                         -- channel price at list time (cents, repo convention)
  status               text NOT NULL DEFAULT 'LISTED',  -- LISTED | ENDED
  listed_at            timestamptz NOT NULL DEFAULT now(),
  listed_by            integer,                         -- staff_id (no FK: staff is a separate concern, mirrors inventory_events.actor_staff_id)
  ended_at             timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- One active listing row per (org, unit, platform): re-listing the same unit on
-- the same channel UPSERTs (markUnitListed is idempotent on this key).
CREATE UNIQUE INDEX IF NOT EXISTS ux_serial_unit_listings_org_unit_platform
  ON serial_unit_listings (organization_id, serial_unit_id, platform);

-- Resolve a channel listing id back to the unit (inbound webhooks / reconcile);
-- partial so many rows without a captured ref id can coexist.
CREATE INDEX IF NOT EXISTS idx_serial_unit_listings_org_platform_ref
  ON serial_unit_listings (organization_id, platform, external_ref_id)
  WHERE external_ref_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_serial_unit_listings_unit
  ON serial_unit_listings (serial_unit_id);

-- ── Arm RLS (NOT enforced; see header caveat) ──────────────────────────────
ALTER TABLE serial_unit_listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS serial_unit_listings_tenant_isolation ON serial_unit_listings;
CREATE POLICY serial_unit_listings_tenant_isolation ON serial_unit_listings
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
