import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';

/**
 * GET /api/get-title-by-sku?sku=<value>
 *
 * Resolves a SKU to {title, stock, location, imageUrl, skuCatalogId, gtin}
 * by probing four tables and merging in priority order:
 *
 *   items              — the Zoho items mirror. The Zoho product display is the
 *                        SOURCE OF TRUTH for the title, so it wins over every
 *                        other table. `items` uses an independent SKU numbering
 *                        that collides with sku_catalog/sku_stock on the same
 *                        string (e.g. SKU 00016 is a different product in each),
 *                        so the title MUST come from here to match the Zoho
 *                        product picker.
 *   sku_platform_ids   — Ecwid platform mappings (display_name + image_url).
 *                        May be unlinked (sku_catalog_id NULL), so we never skip
 *                        this even when sku_catalog also matches.
 *   sku_catalog        — canonical SKU id + GTIN + sometimes image_url.
 *   sku_stock          — stock & location.
 *
 * All matches are case-insensitive, whitespace-trimmed, and leading-zero
 * tolerant in both directions (e.g. '1103' ↔ '01103').
 */
export const GET = withAuth(async (request: NextRequest, ctx) => {
    try {
        const orgId = ctx.organizationId;
        const { searchParams } = new URL(request.url);
        const sku = searchParams.get('sku');

        if (!sku) {
            return NextResponse.json({ error: 'Missing sku query param' }, { status: 400 });
        }

        const trimmedSku = String(sku).trim();
        if (!trimmedSku) {
            return NextResponse.json({ error: 'Empty sku' }, { status: 400 });
        }

        // Four independent lookups, all tolerant of case/whitespace/leading
        // zeros. Run in parallel for one round-trip.
        const [zohoItem, ecwid, catalogDirect, stock] = await Promise.all([
            tenantQuery(
                orgId,
                `SELECT name, image_url, image_document_id, zoho_item_id
                   FROM items
                  WHERE status = 'active'
                    AND organization_id = $2
                    AND (
                      UPPER(TRIM(sku)) = UPPER(TRIM($1))
                      OR regexp_replace(UPPER(TRIM(COALESCE(sku,''))), '^0+', '')
                         = regexp_replace(UPPER(TRIM($1)), '^0+', '')
                    )
                  ORDER BY (UPPER(TRIM(sku)) = UPPER(TRIM($1))) DESC,
                           (name IS NOT NULL AND name <> '') DESC
                  LIMIT 1`,
                [trimmedSku, orgId],
            ),
            tenantQuery(
                orgId,
                `SELECT id, sku_catalog_id, platform_sku, display_name, image_url
                   FROM sku_platform_ids
                  WHERE platform = 'ecwid'
                    AND is_active = true
                    AND organization_id = $2
                    AND (
                      UPPER(TRIM(platform_sku)) = UPPER(TRIM($1))
                      OR regexp_replace(UPPER(TRIM(COALESCE(platform_sku,''))), '^0+', '')
                         = regexp_replace(UPPER(TRIM($1)), '^0+', '')
                    )
                  ORDER BY (UPPER(TRIM(platform_sku)) = UPPER(TRIM($1))) DESC,
                           (image_url IS NOT NULL AND image_url <> '') DESC,
                           (display_name IS NOT NULL AND display_name <> '') DESC,
                           id DESC
                  LIMIT 1`,
                [trimmedSku, orgId],
            ),
            tenantQuery(
                orgId,
                `SELECT id, sku, product_title, image_url, gtin
                   FROM sku_catalog
                  WHERE organization_id = $2
                    AND (
                      UPPER(TRIM(sku)) = UPPER(TRIM($1))
                      OR regexp_replace(UPPER(TRIM(sku)), '^0+', '')
                         = regexp_replace(UPPER(TRIM($1)), '^0+', '')
                    )
                  ORDER BY (UPPER(TRIM(sku)) = UPPER(TRIM($1))) DESC
                  LIMIT 1`,
                [trimmedSku, orgId],
            ),
            tenantQuery(
                orgId,
                `SELECT sku, stock, location, product_title
                   FROM sku_stock
                  WHERE organization_id = $2
                    AND (
                      UPPER(TRIM(sku)) = UPPER(TRIM($1))
                      OR regexp_replace(UPPER(TRIM(sku)), '^0+', '')
                         = regexp_replace(UPPER(TRIM($1)), '^0+', '')
                    )
                  ORDER BY (UPPER(TRIM(sku)) = UPPER(TRIM($1))) DESC
                  LIMIT 1`,
                [trimmedSku, orgId],
            ),
        ]);

        const zohoRow = zohoItem.rows[0] ?? null;
        const ecwidRow = ecwid.rows[0] ?? null;
        let catalogRow = catalogDirect.rows[0] ?? null;
        const stockRow = stock.rows[0] ?? null;

        // If the Ecwid row links to a catalog row we missed by SKU text
        // (because the catalog SKU isn't the Ecwid platform_sku), fetch it.
        if (!catalogRow && ecwidRow?.sku_catalog_id) {
            const linked = await tenantQuery(
                orgId,
                `SELECT id, sku, product_title, image_url, gtin
                   FROM sku_catalog WHERE id = $1 AND organization_id = $2 LIMIT 1`,
                [ecwidRow.sku_catalog_id, orgId],
            );
            catalogRow = linked.rows[0] ?? null;
        }

        if (!zohoRow && !ecwidRow && !catalogRow && !stockRow) {
            return NextResponse.json({
                sku: trimmedSku, title: '', stock: '0', location: '',
                imageUrl: '', skuCatalogId: null, gtin: null,
            });
        }

        return NextResponse.json({
            sku: trimmedSku,
            // Zoho `items` name wins — the Zoho product display is the SoT and is
            // what the product picker shows. Fall back only when this SKU has no
            // active Zoho item.
            title:
                (zohoRow?.name && String(zohoRow.name).trim()) ||
                (ecwidRow?.display_name && String(ecwidRow.display_name).trim()) ||
                catalogRow?.product_title ||
                stockRow?.product_title ||
                '',
            stock: stockRow?.stock != null ? String(stockRow.stock) : '0',
            location: stockRow?.location || '',
            // If this SKU is a Zoho item, only its own photo is valid — the
            // Ecwid/sku_catalog images belong to a DIFFERENT product that shares
            // the SKU string (collision). Prefer the Zoho photo (served via our
            // proxy when the item has an image_document_id); otherwise stay empty.
            // Fall back to Ecwid/catalog images only for non-Zoho SKUs.
            imageUrl:
                (zohoRow?.image_document_id && String(zohoRow.image_document_id).trim()
                    ? `/api/zoho/items/${encodeURIComponent(String(zohoRow.zoho_item_id))}/image`
                    : '') ||
                (zohoRow?.image_url && String(zohoRow.image_url).trim()) ||
                (zohoRow
                    ? ''
                    : (ecwidRow?.image_url && String(ecwidRow.image_url).trim()) ||
                      catalogRow?.image_url ||
                      ''),
            skuCatalogId: catalogRow?.id ?? ecwidRow?.sku_catalog_id ?? null,
            gtin: catalogRow?.gtin || null,
        });
    } catch (error: any) {
        console.error('API error', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}, { permission: 'sku_stock.view' });
