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
 * POST /api/sku-catalog/sync-ecwid-products
 *
 * Fetches all enabled products from Ecwid and upserts them as
 * sku_platform_ids entries (sku_catalog_id = NULL, platform = 'ecwid').
 * Stores Ecwid product name in display_name and thumbnail in image_url.
 * Does NOT auto-pair to Zoho — all pairing is manual via SKU Pairing tab.
 */
export async function POST(_req: NextRequest) {
  try {
    const storeId = requiredEnvAny('ECWID_STORE_ID', ['ECWID_STOREID', 'ECWID_STORE', 'NEXT_PUBLIC_ECWID_STORE_ID']);
    const token = requiredEnvAny('ECWID_API_TOKEN', ['ECWID_TOKEN', 'ECWID_ACCESS_TOKEN', 'NEXT_PUBLIC_ECWID_API_TOKEN']);

    // Fetch all Ecwid products (paginated)
    const allProducts: Array<{
      ecwidProductId: string;
      sku: string | null;
      name: string;
      thumbnailUrl: string | null;
    }> = [];
    let offset = 0;
    const limit = 100;

    for (let page = 0; page < 50; page++) {
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
        const ecwidProductId = String(item.id || '').trim();
        const sku = String(item.sku || '').trim() || null;
        const name = String(item.name || '').trim();
        if (ecwidProductId && name) {
          allProducts.push({
            ecwidProductId,
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
      return NextResponse.json({ success: true, fetched: 0, inserted: 0, updated: 0 });
    }

    let inserted = 0;
    let updated = 0;

    for (const product of allProducts) {
      // Try insert first
      const insertResult = await pool.query(
        `INSERT INTO sku_platform_ids
           (sku_catalog_id, platform, platform_sku, platform_item_id, display_name, image_url, is_active)
         VALUES (NULL, 'ecwid', $1, $2, $3, $4, true)
         ON CONFLICT DO NOTHING`,
        [product.sku, product.ecwidProductId, product.name, product.thumbnailUrl],
      );

      if (insertResult.rowCount && insertResult.rowCount > 0) {
        inserted++;
      } else {
        // Already exists — update display_name and image_url
        const updateResult = await pool.query(
          `UPDATE sku_platform_ids
           SET display_name = $1, image_url = COALESCE($2::text, image_url), is_active = true
           WHERE platform = 'ecwid' AND platform_item_id = $3
             AND (display_name IS DISTINCT FROM $1 OR image_url IS NULL)`,
          [product.name, product.thumbnailUrl, product.ecwidProductId],
        );
        if (updateResult.rowCount && updateResult.rowCount > 0) updated++;
      }
    }

    return NextResponse.json({
      success: true,
      fetched: allProducts.length,
      inserted,
      updated,
      message: `Synced ${inserted} new, updated ${updated} existing Ecwid products`,
    });
  } catch (error: any) {
    console.error('Error in POST /api/sku-catalog/sync-ecwid-products:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to sync Ecwid products' },
      { status: 500 },
    );
  }
}
