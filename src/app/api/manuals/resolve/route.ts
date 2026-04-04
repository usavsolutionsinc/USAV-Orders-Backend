import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeIdentifier } from '@/lib/product-manuals';

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

    const normalizedItemNumber = normalizeIdentifier(itemNumber);

    if (!normalizedItemNumber) {
      return NextResponse.json(
        { success: false, found: false, error: 'itemNumber is required' },
        { status: 400 }
      );
    }

    const result = await pool.query(
      `SELECT
         id,
         item_number,
         product_title,
         display_name,
         google_file_id,
         type,
         updated_at
       FROM product_manuals
       WHERE is_active = TRUE
         AND regexp_replace(UPPER(TRIM(COALESCE(item_number, ''))), '[^A-Z0-9]', '', 'g') = $1
       ORDER BY updated_at DESC`,
      [normalizedItemNumber]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: true, found: false, manuals: [] });
    }

    const manuals = result.rows.map((row) => ({
      id: row.id,
      sku: null,
      itemNumber: row.item_number || null,
      productTitle: row.product_title || null,
      displayName: row.display_name || null,
      googleFileId: row.google_file_id,
      type: row.type || null,
      matchedBy: 'item_number' as const,
      updatedAt: row.updated_at,
      ...buildDocUrls(row.google_file_id),
    }));

    return NextResponse.json({ success: true, found: true, manuals });
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
