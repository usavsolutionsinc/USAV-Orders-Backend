import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

function normalizeIdentifier(rawValue: string): string {
  const cleaned = String(rawValue || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return cleaned.replace(/^0+/, '') || '';
}

function buildDriveUrls(googleFileId: string) {
  return {
    previewUrl: `https://drive.google.com/file/d/${googleFileId}/preview`,
    viewUrl: `https://drive.google.com/file/d/${googleFileId}/view`,
    downloadUrl: `https://drive.google.com/uc?export=download&id=${googleFileId}`,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = String(searchParams.get('sku') || '');
    const itemNumber = String(searchParams.get('itemNumber') || '');

    const normalizedSku = normalizeIdentifier(sku);
    const normalizedItemNumber = normalizeIdentifier(itemNumber);

    if (!normalizedSku && !normalizedItemNumber) {
      return NextResponse.json(
        { success: false, found: false, error: 'sku or itemNumber is required' },
        { status: 400 }
      );
    }

    const result = await pool.query(
      `SELECT
         id,
         sku_normalized,
         item_number_normalized,
         google_file_id,
         manual_version,
         is_active,
         updated_at
       FROM product_manuals
       WHERE is_active = TRUE
         AND (
           ($1 <> '' AND sku_normalized = $1)
           OR ($2 <> '' AND item_number_normalized = $2)
         )
       ORDER BY
         CASE WHEN ($1 <> '' AND sku_normalized = $1) THEN 0 ELSE 1 END,
         updated_at DESC
       LIMIT 1`,
      [normalizedSku, normalizedItemNumber]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({
        success: true,
        found: false,
        manual: null,
      });
    }

    const row = result.rows[0];
    const matchedBy =
      normalizedSku && row.sku_normalized === normalizedSku ? 'sku' : 'item_number';

    return NextResponse.json({
      success: true,
      found: true,
      manual: {
        id: row.id,
        skuNormalized: row.sku_normalized,
        itemNumberNormalized: row.item_number_normalized,
        googleFileId: row.google_file_id,
        manualVersion: row.manual_version || null,
        matchedBy,
        updatedAt: row.updated_at,
        ...buildDriveUrls(row.google_file_id),
      },
    });
  } catch (error: any) {
    if (error?.code === '42P01') {
      return NextResponse.json(
        {
          success: false,
          found: false,
          error: 'product_manuals table not found. Run migrations first.',
        },
        { status: 500 }
      );
    }

    console.error('Error resolving product manual:', error);
    return NextResponse.json(
      {
        success: false,
        found: false,
        error: 'Failed to resolve manual',
        details: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
