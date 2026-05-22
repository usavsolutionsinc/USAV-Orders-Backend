import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * GET /api/get-title-by-sku?sku=<value>
 *
 * Resolves a SKU to {title, stock, location, imageUrl, skuCatalogId, gtin}
 * by probing three tables and merging in priority order:
 *
 *   sku_platform_ids   — Ecwid platform mappings (often the source of truth
 *                        for display_name + image_url). May be unlinked
 *                        (sku_catalog_id NULL), so we never skip this even
 *                        when sku_catalog also matches.
 *   sku_catalog        — canonical SKU + GTIN + sometimes image_url.
 *   sku_stock          — stock & location.
 *
 * All matches are case-insensitive, whitespace-trimmed, and leading-zero
 * tolerant in both directions (e.g. '1103' ↔ '01103').
 */
export const GET = withAuth(async (request: NextRequest) => {
    try {
        const { searchParams } = new URL(request.url);
        const sku = searchParams.get('sku');

        if (!sku) {
            return NextResponse.json({ error: 'Missing sku query param' }, { status: 400 });
        }

        const trimmedSku = String(sku).trim();
        if (!trimmedSku) {
            return NextResponse.json({ error: 'Empty sku' }, { status: 400 });
        }

        // Three independent lookups, all tolerant of case/whitespace/leading
        // zeros. Run in parallel for one round-trip.
        const [ecwid, catalogDirect, stock] = await Promise.all([
            pool.query(
                `SELECT id, sku_catalog_id, platform_sku, display_name, image_url
                   FROM sku_platform_ids
                  WHERE platform = 'ecwid'
                    AND is_active = true
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
                [trimmedSku],
            ),
            pool.query(
                `SELECT id, sku, product_title, image_url, gtin
                   FROM sku_catalog
                  WHERE UPPER(TRIM(sku)) = UPPER(TRIM($1))
                     OR regexp_replace(UPPER(TRIM(sku)), '^0+', '')
                        = regexp_replace(UPPER(TRIM($1)), '^0+', '')
                  ORDER BY (UPPER(TRIM(sku)) = UPPER(TRIM($1))) DESC
                  LIMIT 1`,
                [trimmedSku],
            ),
            pool.query(
                `SELECT sku, stock, location, product_title
                   FROM sku_stock
                  WHERE UPPER(TRIM(sku)) = UPPER(TRIM($1))
                     OR regexp_replace(UPPER(TRIM(sku)), '^0+', '')
                        = regexp_replace(UPPER(TRIM($1)), '^0+', '')
                  ORDER BY (UPPER(TRIM(sku)) = UPPER(TRIM($1))) DESC
                  LIMIT 1`,
                [trimmedSku],
            ),
        ]);

        const ecwidRow = ecwid.rows[0] ?? null;
        let catalogRow = catalogDirect.rows[0] ?? null;
        const stockRow = stock.rows[0] ?? null;

        // If the Ecwid row links to a catalog row we missed by SKU text
        // (because the catalog SKU isn't the Ecwid platform_sku), fetch it.
        if (!catalogRow && ecwidRow?.sku_catalog_id) {
            const linked = await pool.query(
                `SELECT id, sku, product_title, image_url, gtin
                   FROM sku_catalog WHERE id = $1 LIMIT 1`,
                [ecwidRow.sku_catalog_id],
            );
            catalogRow = linked.rows[0] ?? null;
        }

        if (!ecwidRow && !catalogRow && !stockRow) {
            return NextResponse.json({
                sku: trimmedSku, title: '', stock: '0', location: '',
                imageUrl: '', skuCatalogId: null, gtin: null,
            });
        }

        return NextResponse.json({
            sku: trimmedSku,
            title:
                (ecwidRow?.display_name && String(ecwidRow.display_name).trim()) ||
                catalogRow?.product_title ||
                stockRow?.product_title ||
                '',
            stock: stockRow?.stock != null ? String(stockRow.stock) : '0',
            location: stockRow?.location || '',
            imageUrl:
                (ecwidRow?.image_url && String(ecwidRow.image_url).trim()) ||
                catalogRow?.image_url ||
                '',
            skuCatalogId: catalogRow?.id ?? ecwidRow?.sku_catalog_id ?? null,
            gtin: catalogRow?.gtin || null,
        });
    } catch (error: any) {
        console.error('API error', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}, { permission: 'sku_stock.view' });
