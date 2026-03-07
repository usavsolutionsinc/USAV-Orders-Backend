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
    const limitParam = Number(searchParams.get('limit') || 3);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 10) : 3;

    const normalizedSku = normalizeIdentifier(sku);
    const normalizedItemNumber = normalizeIdentifier(itemNumber);

    if (!normalizedSku && !normalizedItemNumber) {
      return NextResponse.json({ success: true, manuals: [] });
    }

    const result = await pool.query(
      `SELECT
         id,
         sku,
         item_number,
         product_title,
         google_file_id,
         type,
         is_active,
         updated_at
       FROM product_manuals
       WHERE
         ($1 <> '' AND regexp_replace(UPPER(TRIM(COALESCE(sku, ''))), '[^A-Z0-9]', '', 'g') = $1)
         OR
         ($2 <> '' AND regexp_replace(UPPER(TRIM(COALESCE(item_number, ''))), '[^A-Z0-9]', '', 'g') = $2)
       ORDER BY is_active DESC, updated_at DESC
       LIMIT $3`,
      [normalizedSku, normalizedItemNumber, limit]
    );

    const manuals = result.rows.map((row) => ({
      id: row.id as number,
      sku: (row.sku as string) || null,
      itemNumber: (row.item_number as string) || null,
      productTitle: (row.product_title as string) || null,
      googleFileId: row.google_file_id as string,
      type: (row.type as string) || null,
      isActive: !!row.is_active,
      updatedAt: row.updated_at as string,
      ...buildDriveUrls(row.google_file_id as string),
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
