import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

function normalizeHeader(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function getHeaderIndex(headers: any[], names: string[]) {
  const normalized = headers.map(normalizeHeader);
  for (const name of names) {
    const idx = normalized.indexOf(normalizeHeader(name));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseOrderDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value).trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseShipDate(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  // Prefer direct string normalization to avoid timezone shifts for date-only values.
  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = isoMatch[2].padStart(2, '0');
    const d = isoMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const usMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const y = usMatch[3];
    const m = usMatch[1].padStart(2, '0');
    const d = usMatch[2].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;

  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields.map(f => f.trim());
}

function parseCsv(content: string): string[][] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  return lines.map(parseCsvLine);
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'CSV file is required' }, { status: 400 });
    }

    const fileName = String(file.name || '').toLowerCase();
    if (!fileName.endsWith('.csv')) {
      return NextResponse.json({ success: false, error: 'Only .csv files are supported' }, { status: 400 });
    }

    const content = await file.text();
    const sourceRows = parseCsv(content);
    if (sourceRows.length < 2) {
      return NextResponse.json({ success: false, error: 'No data found in CSV' }, { status: 404 });
    }

    const headers = sourceRows[0];
    const orderNumberIdx = getHeaderIndex(headers, ['Order - Number', 'Order Number']);
    const trackingIdx = getHeaderIndex(headers, ['Shipment - Tracking Number', 'Tracking']);
    const orderDateIdx = getHeaderIndex(headers, ['Date - Order date', 'Order date', 'Order Date']);
    const shipDateIdx = getHeaderIndex(headers, ['Date - Ship date', 'Ship date', 'Ship Date']);

    const missingCols: string[] = [];
    if (orderNumberIdx === -1) missingCols.push('Order - Number');
    if (trackingIdx === -1) missingCols.push('Shipment - Tracking Number');
    if (orderDateIdx === -1) missingCols.push('Date - Order date');
    if (shipDateIdx === -1) missingCols.push('Date - Ship date');

    if (missingCols.length > 0) {
      return NextResponse.json(
        { success: false, error: `Missing columns in CSV: ${missingCols.join(', ')}` },
        { status: 400 }
      );
    }

    // Keep only the latest row per order_id from the source tab.
    const latestByOrderId = new Map<string, { tracking: string; orderDate: Date | null; shipByDate: string | null }>();
    let skippedMissingOrderId = 0;
    let skippedMissingTracking = 0;

    for (const row of sourceRows.slice(1)) {
      const orderId = String(row[orderNumberIdx] || '').trim();
      const tracking = String(row[trackingIdx] || '').trim();
      const orderDate = parseOrderDate(row[orderDateIdx]);
      const shipByDate = parseShipDate(row[shipDateIdx]);

      if (!orderId) {
        skippedMissingOrderId++;
        continue;
      }
      if (!tracking) {
        skippedMissingTracking++;
        continue;
      }

      latestByOrderId.set(orderId, { tracking, orderDate, shipByDate });
    }

    const entries = Array.from(latestByOrderId.entries());
    if (entries.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No valid ShipStation rows found to sync',
        fileName,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        skippedMissingOrderId,
        skippedMissingTracking,
      });
    }

    const client = await pool.connect();
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    try {
      for (const [orderId, payload] of entries) {
        const existing = await client.query(
          `SELECT id, shipping_tracking_number, order_date, ship_by_date
           FROM orders
           WHERE order_id = $1
           ORDER BY created_at DESC NULLS LAST, id DESC`,
          [orderId]
        );

        if (existing.rows.length === 0) {
          await client.query(
            `INSERT INTO orders (
              order_id,
              shipping_tracking_number,
              order_date,
              ship_by_date,
              status,
              status_history,
              is_shipped,
              created_at
            ) VALUES ($1, $2, $3, $4::date, $5, $6::jsonb, $7, timezone('America/Los_Angeles', now()))`,
            [
              orderId,
              payload.tracking,
              payload.orderDate,
              payload.shipByDate,
              'unassigned',
              JSON.stringify([]),
              false,
            ]
          );
          inserted++;
          continue;
        }

        const needsUpdate = existing.rows.some((row: any) => {
          const currentTracking = String(row.shipping_tracking_number || '').trim();
          const hasOrderDate = !!row.order_date;
          const hasShipByDate = !!row.ship_by_date;
          return (
            currentTracking !== payload.tracking ||
            (!hasOrderDate && payload.orderDate) ||
            (!hasShipByDate && payload.shipByDate)
          );
        });

        if (!needsUpdate) {
          unchanged++;
          continue;
        }

        await client.query(
          `UPDATE orders
           SET shipping_tracking_number = $2,
               order_date = COALESCE($3, order_date),
               ship_by_date = COALESCE($4::date, ship_by_date)
           WHERE order_id = $1`,
          [orderId, payload.tracking, payload.orderDate, payload.shipByDate]
        );

        updated++;
      }
    } finally {
      client.release();
    }

    return NextResponse.json({
      success: true,
      message: `ShipStation sync complete: inserted ${inserted}, updated ${updated}, unchanged ${unchanged}.`,
      fileName,
      inserted,
      updated,
      unchanged,
      skippedMissingOrderId,
      skippedMissingTracking,
    });
  } catch (error: any) {
    console.error('ShipStation sync error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
