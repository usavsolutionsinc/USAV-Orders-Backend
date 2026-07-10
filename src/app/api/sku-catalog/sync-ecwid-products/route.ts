import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { CACHE_TAGS } from '@/lib/cache/tags';
import { deleteSkuPlatformId } from '@/lib/neon/sku-catalog-queries';
import {
  parseEcwidProductItems,
  isEcwidFetchComplete,
  selectStaleEcwidRowIds,
  type EcwidMirrorProduct,
} from '@/lib/ecwid/sync-ecwid-products';

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
 *
 * Reconcile-missing (reversibility 5.4): after upserting, ecwid rows whose
 * product is absent from the latest fetch are soft-deactivated
 * (is_active = false via deleteSkuPlatformId) — but ONLY when the fetch was
 * complete (terminated on a short page, not the page cap). A product that
 * reappears in a later fetch is reactivated by the upsert.
 */
export const POST = withAuth(async (_req: NextRequest, ctx) => {
  try {
    const storeId = requiredEnvAny('ECWID_STORE_ID', ['ECWID_STOREID', 'ECWID_STORE', 'NEXT_PUBLIC_ECWID_STORE_ID']);
    const token = requiredEnvAny('ECWID_API_TOKEN', ['ECWID_TOKEN', 'ECWID_ACCESS_TOKEN', 'NEXT_PUBLIC_ECWID_API_TOKEN']);

    // Fetch all Ecwid products (paginated)
    const allProducts: EcwidMirrorProduct[] = [];
    let offset = 0;
    const limit = 100;
    // True only when pagination terminated on a short page — i.e. we saw the
    // whole catalog. Exhausting the page cap leaves this false, which blocks
    // the deactivate pass (never mass-deactivate on a truncated fetch).
    let fetchComplete = false;

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
      allProducts.push(...parseEcwidProductItems(items));

      if (isEcwidFetchComplete(items.length, limit)) {
        fetchComplete = true;
        break;
      }
      offset += limit;
    }

    if (allProducts.length === 0) {
      // Deliberately skip the deactivate pass on an empty fetch — an empty
      // catalog is indistinguishable from a store misconfig; never nuke the
      // whole mirror on it.
      return NextResponse.json({ success: true, fetched: 0, inserted: 0, updated: 0, deactivated: 0 });
    }

    let inserted = 0;
    let updated = 0;

    for (const product of allProducts) {
      // Try insert first — stamp the owning org on every new platform row.
      const insertResult = await tenantQuery(
        ctx.organizationId,
        `INSERT INTO sku_platform_ids
           (sku_catalog_id, platform, platform_sku, platform_item_id, display_name, image_url, is_active, organization_id)
         VALUES (NULL, 'ecwid', $1, $2, $3, $4, true, $5)
         ON CONFLICT DO NOTHING`,
        [product.sku, product.ecwidProductId, product.name, product.thumbnailUrl, ctx.organizationId],
      );

      if (insertResult.rowCount && insertResult.rowCount > 0) {
        inserted++;
      } else {
        // Already exists — update display_name and image_url (this org's row
        // only). Also reactivates a previously-deactivated mirror row whose
        // product reappeared in the fetch (reverse of the deactivate pass).
        const updateResult = await tenantQuery(
          ctx.organizationId,
          `UPDATE sku_platform_ids
           SET display_name = $1, image_url = COALESCE($2::text, image_url), is_active = true
           WHERE platform = 'ecwid' AND platform_item_id = $3
             AND organization_id = $4
             AND (display_name IS DISTINCT FROM $1 OR image_url IS NULL OR is_active = false)`,
          [product.name, product.thumbnailUrl, product.ecwidProductId, ctx.organizationId],
        );
        if (updateResult.rowCount && updateResult.rowCount > 0) updated++;
      }
    }

    // Reconcile-missing: soft-deactivate active ecwid mirror rows whose
    // product was absent from the fetch — ONLY when the fetch was complete.
    let deactivated = 0;
    if (fetchComplete) {
      const existing = await tenantQuery<{ id: number; platform_item_id: string | null }>(
        ctx.organizationId,
        `SELECT id, platform_item_id
           FROM sku_platform_ids
          WHERE platform = 'ecwid' AND is_active = true AND organization_id = $1`,
        [ctx.organizationId],
      );
      const staleIds = selectStaleEcwidRowIds(
        existing.rows,
        allProducts.map((p) => p.ecwidProductId),
      );
      for (const staleId of staleIds) {
        if (await deleteSkuPlatformId(staleId, ctx.organizationId)) deactivated++;
      }
    }

    // New/updated catalog rows + platform mappings → bust get-title-by-sku bundles.
    await invalidateCacheTags(ctx.organizationId, [CACHE_TAGS.skuCatalog]);

    return NextResponse.json({
      success: true,
      fetched: allProducts.length,
      inserted,
      updated,
      deactivated,
      fetchComplete,
      message: `Synced ${inserted} new, updated ${updated} existing, deactivated ${deactivated} missing Ecwid products`,
    });
  } catch (error: any) {
    console.error('Error in POST /api/sku-catalog/sync-ecwid-products:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to sync Ecwid products' },
      { status: 500 },
    );
  }
}, { permission: 'admin.manage_features' });
