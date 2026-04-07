import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeIdentifier } from '@/lib/product-manuals';
import { resolveSkuCatalogId } from '@/lib/neon/sku-catalog-queries';

function buildDocUrls(googleFileId: string) {
  return {
    previewUrl: `https://docs.google.com/document/d/${googleFileId}/preview`,
    viewUrl: `https://docs.google.com/document/d/${googleFileId}`,
    downloadUrl: `https://docs.google.com/document/d/${googleFileId}/export?format=pdf`,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const itemNumber = String(searchParams.get('itemNumber') || '');
    const sku = String(searchParams.get('sku') || '');
    const limitParam = Number(searchParams.get('limit') || 3);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 10) : 3;

    const normalizedItemNumber = normalizeIdentifier(itemNumber);

    if (!normalizedItemNumber && !sku.trim()) {
      return NextResponse.json({ success: true, manuals: [] });
    }

    // ── Hub-first: resolve through sku_catalog ──────────────────────────────
    const skuCatalogId = await resolveSkuCatalogId(sku || null, itemNumber || null);

    let rows: any[] = [];

    if (skuCatalogId) {
      const hubResult = await pool.query(
        `SELECT
           id,
           item_number,
           product_title,
           display_name,
           google_file_id,
           type,
           is_active,
           updated_at
         FROM product_manuals
         WHERE sku_catalog_id = $1
         ORDER BY is_active DESC, updated_at DESC
         LIMIT $2`,
        [skuCatalogId, limit]
      );
      rows = hubResult.rows;
    }

    // ── Fallback: legacy item_number match for un-migrated records ──────────
    if (rows.length === 0 && normalizedItemNumber) {
      const fallbackResult = await pool.query(
        `SELECT
           id,
           item_number,
           product_title,
           display_name,
           google_file_id,
           type,
           is_active,
           updated_at
         FROM product_manuals
         WHERE regexp_replace(UPPER(TRIM(COALESCE(item_number, ''))), '[^A-Z0-9]', '', 'g') = $1
         ORDER BY is_active DESC, updated_at DESC
         LIMIT $2`,
        [normalizedItemNumber, limit]
      );
      rows = fallbackResult.rows;
    }

    const manuals = rows.map((row) => ({
      id: row.id as number,
      itemNumber: (row.item_number as string) || null,
      productTitle: (row.product_title as string) || null,
      displayName: (row.display_name as string) || null,
      googleFileId: row.google_file_id as string,
      type: (row.type as string) || null,
      isActive: !!row.is_active,
      updatedAt: row.updated_at as string,
      ...buildDocUrls(row.google_file_id as string),
    }));

    return NextResponse.json({ success: true, manuals });
  } catch (error: any) {
    console.error('Error fetching recent manuals:', error);
    return NextResponse.json(
      { success: false, manuals: [], error: 'Failed to fetch recent manuals', details: error?.message },
      { status: 500 }
    );
  }
}
