import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

function normalizeIdentifier(rawValue: string): string {
  const cleaned = String(rawValue || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.replace(/^0+/, '') || '';
}

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
    const sku = normalizeIdentifier(String(body?.sku || ''));
    const itemNumber = normalizeIdentifier(String(body?.itemNumber || ''));
    const googleFileId = extractGoogleFileId(String(body?.googleLinkOrFileId || ''));
    const type = String(body?.type || '').trim() || null;

    if (!sku && !itemNumber) {
      return NextResponse.json({ success: false, error: 'sku or itemNumber is required' }, { status: 400 });
    }
    if (!googleFileId) {
      return NextResponse.json({ success: false, error: 'Valid Google Drive file id/link is required' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (sku) {
        await client.query('UPDATE product_manuals SET is_active = FALSE WHERE is_active = TRUE AND sku = $1', [sku]);
      }
      if (itemNumber) {
        await client.query('UPDATE product_manuals SET is_active = FALSE WHERE is_active = TRUE AND item_number = $1', [itemNumber]);
      }

      const inserted = await client.query(
        `INSERT INTO product_manuals (sku, item_number, google_file_id, type, is_active, updated_at)
         VALUES ($1, $2, $3, $4, TRUE, NOW())
         RETURNING id`,
        [sku || null, itemNumber || null, googleFileId, type]
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
