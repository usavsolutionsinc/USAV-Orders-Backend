-- GIN trigram index for fuzzy title matching on sku_catalog.
-- Used by the Ecwid→Zoho bridging script and the pair-suggestions API
-- to find candidate matches via similarity(product_title, ecwid.display_name).
-- pg_trgm extension is already installed.

CREATE INDEX IF NOT EXISTS idx_sku_catalog_product_title_trgm
  ON sku_catalog USING gin (product_title gin_trgm_ops);
