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
         sku,
         item_number,
         google_file_id,
         type,
         is_active,
         updated_at
       FROM product_manuals
       WHERE is_active = TRUE
         AND (
           ($1 <> '' AND regexp_replace(UPPER(TRIM(COALESCE(sku, ''))), '[^A-Z0-9]', '', 'g') = $1)
           OR ($2 <> '' AND regexp_replace(UPPER(TRIM(COALESCE(item_number, ''))), '[^A-Z0-9]', '', 'g') = $2)
         )
       ORDER BY
         CASE WHEN ($1 <> '' AND regexp_replace(UPPER(TRIM(COALESCE(sku, ''))), '[^A-Z0-9]', '', 'g') = $1) THEN 0 ELSE 1 END,
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
      normalizedSku &&
      normalizeIdentifier(String(row.sku || '')) === normalizedSku
        ? 'sku'
        : 'item_number';

    return NextResponse.json({
      success: true,
      found: true,
      manual: {
        id: row.id,
        sku: row.sku || null,
        itemNumber: row.item_number || null,
        googleFileId: row.google_file_id,
        type: row.type || null,
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
