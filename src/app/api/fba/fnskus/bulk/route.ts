import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

type Row = {
  fnsku: string;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  condition: string | null;
  is_active: boolean | null;
};

const ALLOWED_HEADERS = new Set(['fnsku', 'product_title', 'asin', 'sku', 'condition', 'is_active']);
const REQUIRED_HEADERS = ['fnsku', 'product_title'];

function parseBool(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return null;
}

function splitCsvLine(line: string): string[] {
  // Lightweight CSV split (no nested quotes support). Suitable for simple uploads.
  return line.split(',').map((cell) => cell.trim());
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'file is required' }, { status: 400 });
    }

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      return NextResponse.json({ success: false, error: 'CSV is empty' }, { status: 400 });
    }

    const headerCells = splitCsvLine(lines.shift()!);
    const lowerHeaders = headerCells.map((h) => h.toLowerCase());
    const invalidHeaders = lowerHeaders.filter((h) => !ALLOWED_HEADERS.has(h));
    if (invalidHeaders.length > 0) {
      return NextResponse.json(
        { success: false, error: `Unsupported column(s): ${invalidHeaders.join(', ')}` },
        { status: 400 }
      );
    }
    for (const required of REQUIRED_HEADERS) {
      if (!lowerHeaders.includes(required)) {
        return NextResponse.json(
          { success: false, error: `Missing required column: ${required}` },
          { status: 400 }
        );
      }
    }

    const headerIndex: Record<string, number> = {};
    lowerHeaders.forEach((h, idx) => {
      headerIndex[h] = idx;
    });

    const rows: Row[] = [];
    for (const line of lines) {
      const cells = splitCsvLine(line);
      const fnsku = (cells[headerIndex['fnsku']] || '').toUpperCase().trim();
      if (!fnsku) continue;
      const product_title = (cells[headerIndex['product_title']] || '').trim() || null;
      const asin = headerIndex['asin'] !== undefined ? (cells[headerIndex['asin']] || '').trim().toUpperCase() || null : null;
      const sku = headerIndex['sku'] !== undefined ? (cells[headerIndex['sku']] || '').trim() || null : null;
      const condition =
        headerIndex['condition'] !== undefined ? (cells[headerIndex['condition']] || '').trim() || null : null;
      const is_active = headerIndex['is_active'] !== undefined ? parseBool(cells[headerIndex['is_active']]) : null;
      rows.push({ fnsku, product_title, asin, sku, condition, is_active });
    }

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid rows found' }, { status: 400 });
    }
    if (rows.length > 1000) {
      return NextResponse.json({ success: false, error: 'Too many rows (max 1000)' }, { status: 400 });
    }

    // Deduplicate by FNSKU, latest row wins
    const uniqueMap = new Map<string, Row>();
    rows.forEach((r) => uniqueMap.set(r.fnsku, r));
    const unique = Array.from(uniqueMap.values());

    const values: any[] = [];
    const placeholders: string[] = [];
    unique.forEach((row, idx) => {
      const base = idx * 6;
      values.push(row.fnsku, row.product_title, row.asin, row.sku, row.condition, row.is_active ?? true);
      placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
    });

    await pool.query(
      `INSERT INTO fba_fnskus (fnsku, product_title, asin, sku, condition, is_active, created_at, updated_at, last_seen_at)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (fnsku) DO UPDATE
         SET product_title = COALESCE(EXCLUDED.product_title, fba_fnskus.product_title),
             asin          = COALESCE(EXCLUDED.asin, fba_fnskus.asin),
             sku           = COALESCE(EXCLUDED.sku, fba_fnskus.sku),
             condition     = COALESCE(EXCLUDED.condition, fba_fnskus.condition),
             is_active     = COALESCE(EXCLUDED.is_active, fba_fnskus.is_active),
             updated_at    = NOW(),
             last_seen_at  = NOW()
      `,
      values
    );

    return NextResponse.json({ success: true, inserted: unique.length });
  } catch (error: any) {
    console.error('[POST /api/fba/fnskus/bulk]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Bulk upload failed' },
      { status: 500 }
    );
  }
}
