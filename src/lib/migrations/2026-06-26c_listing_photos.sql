-- ============================================================================
-- 2026-06-26c: listing_photos — the marketplace gallery composition table
-- ============================================================================
-- A marketplace listing is an ORDERED, curated set of photos with a cover/hero
-- — structurally the same reason photo_share_pack_items exists (sort_order +
-- export_filename). photo_entity_links is generic/polymorphic and must NOT grow
-- listing-specific sort_order / is_cover columns, so the gallery composition gets
-- its own join table.
--
-- A listing_photos row attaches an existing photo (already in GCS under the
-- 'listing' type, see 2026-06-26b) to a target. The target is one (or more) of:
--   * sku_catalog_id          — a reusable SKU-level gallery (stock photos)
--   * serial_unit_id          — actual-condition photos of the one item
--   * platform_listing_id     — a specific channel listing (eBay/Amazon offer)
--   * serial_unit_listing_id  — a per-unit channel listing fact
-- At least one target must be set (enforced in the domain layer, not a CHECK, so
-- a row can carry both a SKU and a channel-listing target).
--
-- Note the FK id-width split: sku_catalog.id / serial_units.id are SERIAL
-- (integer); platform_listings.id / serial_unit_listings.id are bigserial.
--
-- Tenant-from-birth: organization_id UUID NOT NULL, enforce_tenant_isolation().
-- The only writer (lib/photos/listing-photos.ts via /api/photos/listing-gallery)
-- runs inside withTenantTransaction and stamps organization_id explicitly.
--
-- ROLLBACK:
--   select relax_tenant_isolation('listing_photos');
--   DROP TABLE IF EXISTS listing_photos;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS listing_photos (
  id                     BIGSERIAL PRIMARY KEY,
  organization_id        UUID NOT NULL,              -- no DEFAULT; helper installs the loud-fail GUC default
  photo_id               BIGINT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  -- Targets (at least one set; both a SKU + a channel-listing target is allowed):
  sku_catalog_id         INTEGER REFERENCES sku_catalog(id) ON DELETE CASCADE,
  serial_unit_id         INTEGER REFERENCES serial_units(id) ON DELETE CASCADE,
  platform_listing_id    BIGINT  REFERENCES platform_listings(id) ON DELETE CASCADE,
  serial_unit_listing_id BIGINT  REFERENCES serial_unit_listings(id) ON DELETE CASCADE,
  sort_order             SMALLINT NOT NULL DEFAULT 0,
  is_cover               BOOLEAN  NOT NULL DEFAULT FALSE,
  export_filename        TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Gallery reads by target (ordered).
CREATE INDEX IF NOT EXISTS idx_listing_photos_sku
  ON listing_photos (organization_id, sku_catalog_id, sort_order)
  WHERE sku_catalog_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listing_photos_unit
  ON listing_photos (organization_id, serial_unit_id, sort_order)
  WHERE serial_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listing_photos_platform
  ON listing_photos (organization_id, platform_listing_id)
  WHERE platform_listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listing_photos_unit_listing
  ON listing_photos (organization_id, serial_unit_listing_id)
  WHERE serial_unit_listing_id IS NOT NULL;

-- A photo appears at most once per SKU gallery / per unit gallery.
CREATE UNIQUE INDEX IF NOT EXISTS ux_listing_photos_sku_photo
  ON listing_photos (organization_id, sku_catalog_id, photo_id)
  WHERE sku_catalog_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_listing_photos_unit_photo
  ON listing_photos (organization_id, serial_unit_id, photo_id)
  WHERE serial_unit_id IS NOT NULL;

-- At most one cover per SKU gallery / per unit gallery.
CREATE UNIQUE INDEX IF NOT EXISTS ux_listing_photos_cover_sku
  ON listing_photos (organization_id, sku_catalog_id)
  WHERE is_cover AND sku_catalog_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_listing_photos_cover_unit
  ON listing_photos (organization_id, serial_unit_id)
  WHERE is_cover AND serial_unit_id IS NOT NULL;

COMMENT ON TABLE listing_photos IS
  'Ordered marketplace gallery composition: which photos compose a SKU/unit/channel-listing gallery, in what order, and which is the cover. Analogous to photo_share_pack_items.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('listing_photos');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — listing_photos left without FORCE RLS';
  END IF;
END $$;

COMMIT;
