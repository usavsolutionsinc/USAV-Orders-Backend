import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeIdentifier } from '@/lib/product-manuals';

function extractGoogleFileId(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (!raw.includes('drive.google.com')) return raw;

  const dMatch = raw.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (dMatch?.[1]) return dMatch[1];

  const idMatch = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch?.[1]) return idMatch[1];

  return '';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const itemNumber = normalizeIdentifier(String(body?.itemNumber || ''));
    const productTitle = String(body?.productTitle || body?.product_title || '').trim() || null;
    const displayName =
      String(body?.displayName || body?.display_name || '').trim()
      || productTitle
      || (itemNumber ? `${itemNumber} Manual` : null);
    const googleFileId = extractGoogleFileId(String(body?.googleLinkOrFileId || ''));
    const type = String(body?.type || '').trim() || null;

    if (!itemNumber) {
      return NextResponse.json({ success: false, error: 'itemNumber is required' }, { status: 400 });
    }
    if (!googleFileId) {
      return NextResponse.json({ success: false, error: 'Valid Google Drive file id/link is required' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        'UPDATE product_manuals SET is_active = FALSE WHERE is_active = TRUE AND item_number = $1 AND (type = $2 OR ($2 IS NULL AND type IS NULL))',
        [itemNumber, type]
      );

      const inserted = await client.query(
        `INSERT INTO product_manuals (sku, item_number, product_title, display_name, google_file_id, type, is_active, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())
         RETURNING id`,
        [null, itemNumber || null, productTitle, displayName, googleFileId, type]
      );

      await client.query('COMMIT');
      return NextResponse.json({ success: true, id: inserted.rows[0]?.id ?? null });
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error upserting product manual:', error);
    return NextResponse.json({ success: false, error: 'Failed to save manual', details: error?.message }, { status: 500 });
  }
}
