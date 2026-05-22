import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { batchPair } from '@/lib/neon/pairing-queries';

/**
 * POST /api/sku-catalog/pair  (compatibility shim)
 *
 * Pairs a single platform item_number to a sku_catalog entry. Existed before
 * pair-batch landed and is still called by the manuals SkuPairingPanel.
 *
 * Internally delegates to batchPair with one accept entry so backfill,
 * audit, and idempotency semantics match the new endpoint exactly.
 *
 * Body: { skuCatalogId, itemNumber, platform, accountName? }
 *
 * DELETE /api/sku-catalog/pair  (unchanged)
 * Removes a platform pairing row entirely. Body: { platformIdRowId }.
 */
export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const body = await req.json();
      const skuCatalogId = Number(body.skuCatalogId);
      const itemNumber = String(body.itemNumber || '').trim();
      const platform = String(body.platform || '').trim();
      const accountName = body.accountName ? String(body.accountName).trim() : null;

      if (!skuCatalogId || !Number.isFinite(skuCatalogId)) {
        return NextResponse.json(
          { success: false, error: 'skuCatalogId is required' },
          { status: 400 },
        );
      }
      if (!itemNumber) {
        return NextResponse.json(
          { success: false, error: 'itemNumber is required' },
          { status: 400 },
        );
      }
      if (!platform) {
        return NextResponse.json(
          { success: false, error: 'platform is required' },
          { status: 400 },
        );
      }

      const result = await batchPair({
        skuCatalogId,
        actorId: ctx.staffId,
        actorKind: 'user',
        accept: [
          {
            platform,
            platformItemId: itemNumber,
            accountName,
            reason: 'manual_single_pair',
          },
        ],
        reject: [],
      });

      // Legacy response shape preserved for existing manuals UI callers.
      return NextResponse.json({
        success: true,
        platformId: null,
        ordersUpdated: result.ordersBackfilled,
        manualsUpdated: result.manualsBackfilled,
      });
    } catch (error: any) {
      console.error('[sku-catalog/pair] Error:', error);
      return NextResponse.json(
        { success: false, error: error?.message || 'Failed to pair SKU' },
        { status: 500 },
      );
    }
  },
  { permission: 'sku_stock.manage' },
);

export const DELETE = withAuth(
  async (req: NextRequest) => {
    try {
      const body = await req.json();
      const platformIdRowId = Number(body.platformIdRowId);

      if (!platformIdRowId || !Number.isFinite(platformIdRowId)) {
        return NextResponse.json(
          { success: false, error: 'platformIdRowId is required' },
          { status: 400 },
        );
      }

      const result = await pool.query(
        `DELETE FROM sku_platform_ids WHERE id = $1 RETURNING *`,
        [platformIdRowId],
      );

      return NextResponse.json({
        success: true,
        deleted: result.rows[0] ?? null,
      });
    } catch (error: any) {
      console.error('[sku-catalog/pair] DELETE Error:', error);
      return NextResponse.json(
        { success: false, error: error?.message || 'Failed to remove pairing' },
        { status: 500 },
      );
    }
  },
  { permission: 'sku_stock.manage' },
);
