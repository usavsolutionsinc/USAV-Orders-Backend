-- ============================================================================
-- 2026-04-07: Backfill sku_catalog hub from existing data
-- ============================================================================
-- Seeds sku_catalog from items (Zoho catalog).
-- Seeds sku_platform_ids from items (zoho), fba_fnskus (amazon_fba), and
-- orders (ebay, amazon, walmart, ecwid) based on account_source patterns.
-- Backfills sku_catalog_id FK on orders, fba_fnskus, and product_manuals.
-- ============================================================================

BEGIN;

-- ─── Step 1: Seed sku_catalog from items table (Zoho SoT) ───────────────────

INSERT INTO sku_catalog (sku, product_title, upc, ean, image_url, is_active)
SELECT DISTINCT ON (BTRIM(sku))
  BTRIM(sku),
  COALESCE(BTRIM(name), 'Unknown Product'),
  NULLIF(BTRIM(upc), ''),
  NULLIF(BTRIM(ean), ''),
  NULLIF(BTRIM(image_url), ''),
  (status = 'active')
FROM items
WHERE sku IS NOT NULL AND BTRIM(sku) != ''
ORDER BY BTRIM(sku), synced_at DESC
ON CONFLICT (sku) DO NOTHING;

-- ─── Step 2a: Seed sku_platform_ids — Zoho entries ──────────────────────────

INSERT INTO sku_platform_ids (sku_catalog_id, platform, platform_sku)
SELECT sc.id, 'zoho', sc.sku
FROM sku_catalog sc
ON CONFLICT DO NOTHING;

-- ─── Step 2b: Seed sku_platform_ids — FBA (FNSKU → ASIN) ───────────────────

INSERT INTO sku_platform_ids (sku_catalog_id, platform, platform_sku, platform_item_id)
SELECT sc.id, 'amazon_fba', f.fnsku, NULLIF(BTRIM(f.asin), '')
FROM fba_fnskus f
JOIN sku_catalog sc ON sc.sku = BTRIM(f.sku)
WHERE f.sku IS NOT NULL AND BTRIM(f.sku) != ''
ON CONFLICT DO NOTHING;

-- ─── Step 2c: Seed sku_platform_ids — from orders (eBay, Amazon, Walmart, Ecwid) ─

-- eBay orders: account_source starts with 'ebay' or order_id matches eBay pattern
INSERT INTO sku_platform_ids (sku_catalog_id, platform, platform_item_id, account_name)
SELECT DISTINCT ON (sc.id, BTRIM(o.item_number), COALESCE(NULLIF(BTRIM(o.account_source), ''), ''))
  sc.id,
  'ebay',
  BTRIM(o.item_number),
  NULLIF(BTRIM(o.account_source), '')
FROM orders o
JOIN sku_catalog sc ON sc.sku = BTRIM(o.sku)
WHERE o.item_number IS NOT NULL AND BTRIM(o.item_number) != ''
  AND o.sku IS NOT NULL AND BTRIM(o.sku) != ''
  AND (
    LOWER(BTRIM(COALESCE(o.account_source, ''))) LIKE 'ebay%'
    OR o.order_id ~ '^\d{2}-\d+-\d+$'
  )
ORDER BY sc.id, BTRIM(o.item_number), COALESCE(NULLIF(BTRIM(o.account_source), ''), ''), o.created_at DESC
ON CONFLICT DO NOTHING;

-- Amazon orders: order_id matches Amazon pattern (###-#######-#######)
INSERT INTO sku_platform_ids (sku_catalog_id, platform, platform_item_id)
SELECT DISTINCT ON (sc.id, BTRIM(o.item_number))
  sc.id,
  'amazon',
  BTRIM(o.item_number)
FROM orders o
JOIN sku_catalog sc ON sc.sku = BTRIM(o.sku)
WHERE o.item_number IS NOT NULL AND BTRIM(o.item_number) != ''
  AND o.sku IS NOT NULL AND BTRIM(o.sku) != ''
  AND o.order_id ~ '^\d{3}-\d+-\d+$'
  AND LOWER(COALESCE(o.account_source, '')) NOT LIKE 'ebay%'
  AND LOWER(COALESCE(o.account_source, '')) != 'fba'
ORDER BY sc.id, BTRIM(o.item_number), o.created_at DESC
ON CONFLICT DO NOTHING;

-- Walmart orders: 15-digit order_id
INSERT INTO sku_platform_ids (sku_catalog_id, platform, platform_item_id)
SELECT DISTINCT ON (sc.id, BTRIM(o.item_number))
  sc.id,
  'walmart',
  BTRIM(o.item_number)
FROM orders o
JOIN sku_catalog sc ON sc.sku = BTRIM(o.sku)
WHERE o.item_number IS NOT NULL AND BTRIM(o.item_number) != ''
  AND o.sku IS NOT NULL AND BTRIM(o.sku) != ''
  AND o.order_id ~ '^\d{15}$'
ORDER BY sc.id, BTRIM(o.item_number), o.created_at DESC
ON CONFLICT DO NOTHING;

-- Ecwid orders: 4-digit order_id or account_source='ecwid'
INSERT INTO sku_platform_ids (sku_catalog_id, platform, platform_item_id)
SELECT DISTINCT ON (sc.id, BTRIM(o.item_number))
  sc.id,
  'ecwid',
  BTRIM(o.item_number)
FROM orders o
JOIN sku_catalog sc ON sc.sku = BTRIM(o.sku)
WHERE o.item_number IS NOT NULL AND BTRIM(o.item_number) != ''
  AND o.sku IS NOT NULL AND BTRIM(o.sku) != ''
  AND (
    o.order_id ~ '^\d{4}$'
    OR LOWER(BTRIM(COALESCE(o.account_source, ''))) = 'ecwid'
  )
ORDER BY sc.id, BTRIM(o.item_number), o.created_at DESC
ON CONFLICT DO NOTHING;

-- ─── Step 3: Backfill FK columns ────────────────────────────────────────────

-- orders.sku_catalog_id via SKU text match
UPDATE orders o
SET sku_catalog_id = sc.id
FROM sku_catalog sc
WHERE sc.sku = BTRIM(o.sku)
  AND o.sku IS NOT NULL AND BTRIM(o.sku) != ''
  AND o.sku_catalog_id IS NULL;

-- fba_fnskus.sku_catalog_id via SKU text match
UPDATE fba_fnskus f
SET sku_catalog_id = sc.id
FROM sku_catalog sc
WHERE sc.sku = BTRIM(f.sku)
  AND f.sku IS NOT NULL AND BTRIM(f.sku) != ''
  AND f.sku_catalog_id IS NULL;

-- product_manuals.sku_catalog_id via item_number → sku_platform_ids
UPDATE product_manuals pm
SET sku_catalog_id = sp.sku_catalog_id
FROM sku_platform_ids sp
WHERE regexp_replace(UPPER(TRIM(COALESCE(pm.item_number, ''))), '[^A-Z0-9]', '', 'g')
    = regexp_replace(UPPER(TRIM(COALESCE(sp.platform_item_id, ''))), '[^A-Z0-9]', '', 'g')
  AND pm.item_number IS NOT NULL AND BTRIM(pm.item_number) != ''
  AND sp.platform_item_id IS NOT NULL
  AND pm.sku_catalog_id IS NULL;

-- Fallback: product_manuals via direct SKU match on sku_catalog
UPDATE product_manuals pm
SET sku_catalog_id = sc.id
FROM sku_catalog sc
WHERE sc.sku = BTRIM(pm.sku)
  AND pm.sku IS NOT NULL AND BTRIM(pm.sku) != ''
  AND pm.sku_catalog_id IS NULL;

COMMIT;
