import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/sku-catalog/pair
 *
 * Pairs a platform item_number to a sku_catalog entry.
 * Creates a sku_platform_ids row and backfills sku_catalog_id on all matching orders.
 *
 * Body: { skuCatalogId, itemNumber, platform, accountName? }
 *
 * DELETE /api/sku-catalog/pair
 *
 * Removes a platform pairing.
 * Body: { platformIdRowId }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const skuCatalogId = Number(body.skuCatalogId);
    const itemNumber = String(body.itemNumber || '').trim();
    const platform = String(body.platform || '').trim();
    const accountName = body.accountName ? String(body.accountName).trim() : null;

    if (!skuCatalogId || !Number.isFinite(skuCatalogId)) {
      return NextResponse.json({ success: false, error: 'skuCatalogId is required' }, { status: 400 });
    }
    if (!itemNumber) {
      return NextResponse.json({ success: false, error: 'itemNumber is required' }, { status: 400 });
    }
    if (!platform) {
      return NextResponse.json({ success: false, error: 'platform is required' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Create sku_platform_ids entry
      const platformRow = await client.query(
        `INSERT INTO sku_platform_ids (sku_catalog_id, platform, platform_item_id, account_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [skuCatalogId, platform, itemNumber, accountName],
      );

      // 2. Backfill sku_catalog_id on all matching orders
      const backfill = await client.query(
        `UPDATE orders
         SET sku_catalog_id = $1
         WHERE sku_catalog_id IS NULL
           AND item_number IS NOT NULL
           AND regexp_replace(UPPER(TRIM(item_number)), '[^A-Z0-9]', '', 'g')
             = regexp_replace(UPPER(TRIM($2::text)), '[^A-Z0-9]', '', 'g')`,
        [skuCatalogId, itemNumber],
      );

      // 3. Backfill sku_catalog_id on matching product_manuals
      const manualBackfill = await client.query(
        `UPDATE product_manuals
         SET sku_catalog_id = $1
         WHERE sku_catalog_id IS NULL
           AND item_number IS NOT NULL
           AND regexp_replace(UPPER(TRIM(COALESCE(item_number, ''))), '[^A-Z0-9]', '', 'g')
             = regexp_replace(UPPER(TRIM($2::text)), '[^A-Z0-9]', '', 'g')`,
        [skuCatalogId, itemNumber],
      );

      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        platformId: platformRow.rows[0] ?? null,
        ordersUpdated: backfill.rowCount ?? 0,
        manualsUpdated: manualBackfill.rowCount ?? 0,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('[sku-catalog/pair] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to pair SKU' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const platformIdRowId = Number(body.platformIdRowId);

    if (!platformIdRowId || !Number.isFinite(platformIdRowId)) {
      return NextResponse.json({ success: false, error: 'platformIdRowId is required' }, { status: 400 });
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
}
