import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

type CsvRow = string[];

function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(field.trim());
      field = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(field.trim());
      field = '';
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some((value) => value.length > 0)) rows.push(row);
  }

  return rows;
}

function normalizeHeader(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getIndex(headers: string[], keys: string[]): number {
  for (const key of keys) {
    const idx = headers.indexOf(key);
    if (idx >= 0) return idx;
  }
  return -1;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'CSV file is required' }, { status: 400 });
    }

    const raw = await file.text();
    const parsed = parseCsv(raw);
    if (parsed.length === 0) {
      return NextResponse.json({ error: 'CSV is empty' }, { status: 400 });
    }

    const normalizedHeaders = parsed[0].map(normalizeHeader);
    const productTitleIdx = getIndex(normalizedHeaders, ['product_title', 'title', 'name']);
    const asinIdx = getIndex(normalizedHeaders, ['asin']);
    const skuIdx = getIndex(normalizedHeaders, ['sku']);
    const fnskuIdx = getIndex(normalizedHeaders, ['fnsku', 'f_n_s_k_u']);

    if (fnskuIdx < 0) {
      return NextResponse.json({ error: 'CSV must include an fnsku column' }, { status: 400 });
    }

    const seen = new Set<string>();
    const rowsToInsert: Array<[string | null, string | null, string | null, string]> = [];
    let skipped = 0;

    for (const row of parsed.slice(1)) {
      const productTitle = productTitleIdx >= 0 ? String(row[productTitleIdx] || '').trim() : '';
      const asin = asinIdx >= 0 ? String(row[asinIdx] || '').trim() : '';
      const sku = skuIdx >= 0 ? String(row[skuIdx] || '').trim() : '';
      const fnsku = String(row[fnskuIdx] || '').trim().toUpperCase();

      if (!fnsku) {
        skipped++;
        continue;
      }
      if (seen.has(fnsku)) {
        skipped++;
        continue;
      }
      seen.add(fnsku);

      rowsToInsert.push([productTitle || null, asin || null, sku || null, fnsku]);
    }

    if (rowsToInsert.length === 0) {
      return NextResponse.json({ success: true, inserted: 0, skipped });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rowsToInsert) {
        await client.query(
          'INSERT INTO fba_fnskus (product_title, asin, sku, fnsku) VALUES ($1, $2, $3, $4)',
          row
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return NextResponse.json({ success: true, inserted: rowsToInsert.length, skipped });
  } catch (error: any) {
    console.error('Failed to upload fba_fnskus CSV:', error);
    return NextResponse.json({ error: 'Failed to upload CSV' }, { status: 500 });
  }
}
