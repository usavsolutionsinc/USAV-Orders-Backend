import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

const ECWID_BASE_URL = 'https://app.ecwid.com/api/v3';

function requiredEnvAny(primaryName: string, aliases: string[] = []): string {
  for (const key of [primaryName, ...aliases]) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  throw new Error(`Missing required environment variable: ${primaryName}`);
}

/**
 * POST /api/sku-catalog/sync-ecwid-titles
 *
 * Fetches all enabled products from Ecwid, matches by SKU to sku_catalog,
 * and updates product_title with the Ecwid name.
 * Also backfills image_url from Ecwid thumbnails where missing.
 */
export async function POST(_req: NextRequest) {
  try {
    const storeId = requiredEnvAny('ECWID_STORE_ID', ['ECWID_STOREID', 'ECWID_STORE', 'NEXT_PUBLIC_ECWID_STORE_ID']);
    const token = requiredEnvAny('ECWID_API_TOKEN', ['ECWID_TOKEN', 'ECWID_ACCESS_TOKEN', 'NEXT_PUBLIC_ECWID_API_TOKEN']);

    // Fetch all products from Ecwid (paginate)
    const allProducts: Array<{ sku: string; name: string; thumbnailUrl: string | null }> = [];
    let offset = 0;
    const limit = 100;
    const maxPages = 50;

    for (let page = 0; page < maxPages; page++) {
      const url = new URL(`${ECWID_BASE_URL}/${storeId}/products`);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('enabled', 'true');

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Ecwid fetch failed (${res.status}): ${text}`);
      }

      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];

      for (const item of items) {
        const sku = String(item.sku || '').trim();
        const name = String(item.name || '').trim();
        if (sku && name) {
          allProducts.push({
            sku,
            name,
            thumbnailUrl: typeof item.thumbnailUrl === 'string' ? item.thumbnailUrl : null,
          });
        }
      }

      if (items.length < limit) break;
      offset += limit;
    }

    if (allProducts.length === 0) {
      return NextResponse.json({ success: true, matched: 0, updated: 0, message: 'No Ecwid products found' });
    }

    // Build set of Ecwid SKUs for deactivation check
    const ecwidSkus = new Set(allProducts.map((p) => p.sku));

    // Batch update sku_catalog where SKU matches
    let updated = 0;
    for (const product of allProducts) {
      const result = await pool.query(
        `UPDATE sku_catalog
         SET product_title = $1,
             image_url = COALESCE(image_url, $2::text),
             updated_at = NOW()
         WHERE sku = $3
           AND (product_title IS DISTINCT FROM $1 OR (image_url IS NULL AND $2::text IS NOT NULL))`,
        [product.name, product.thumbnailUrl, product.sku],
      );
      if (result.rowCount && result.rowCount > 0) updated++;
    }

    // Deactivate sku_catalog entries that don't exist in Ecwid
    const skuArray = Array.from(ecwidSkus);
    const deactivated = await pool.query(
      `UPDATE sku_catalog
       SET is_active = false, updated_at = NOW()
       WHERE is_active = true
         AND sku != ALL($1::text[])`,
      [skuArray],
    );
    const deactivatedCount = deactivated.rowCount || 0;

    return NextResponse.json({
      success: true,
      matched: allProducts.length,
      updated,
      deactivated: deactivatedCount,
      message: `Synced ${updated} title${updated !== 1 ? 's' : ''}, deactivated ${deactivatedCount} non-Ecwid SKU${deactivatedCount !== 1 ? 's' : ''}`,
    });
  } catch (error: any) {
    console.error('Error in POST /api/sku-catalog/sync-ecwid-titles:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to sync Ecwid titles' },
      { status: 500 },
    );
  }
}
