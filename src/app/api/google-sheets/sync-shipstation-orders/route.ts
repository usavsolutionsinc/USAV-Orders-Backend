import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';

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
    const shipDateIdx = getHeaderIndex(headers, ['Date - Shipped Date', 'Date - Ship date', 'Ship date', 'Ship Date']);

    const missingCols: string[] = [];
    if (orderNumberIdx === -1) missingCols.push('Order - Number');
    if (trackingIdx === -1) missingCols.push('Shipment - Tracking Number');
    if (orderDateIdx === -1) missingCols.push('Date - Order date');
    if (shipDateIdx === -1) missingCols.push('Date - Shipped Date');

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
    let matchedExceptions = 0;
    let clearedExceptions = 0;
    let skippedNoExceptionMatch = 0;
    let skippedInvalidTracking = 0;

    try {
      for (const [orderId, payload] of entries) {
        const trackingKey18 = normalizeTrackingKey18(payload.tracking);
        if (!trackingKey18) {
          skippedInvalidTracking++;
          continue;
        }

        const openExceptions = await client.query(
          `SELECT id
           FROM orders_exceptions
           WHERE status = 'open'
             AND RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
           ORDER BY id ASC`,
          [trackingKey18]
        );

        if (openExceptions.rows.length === 0) {
          skippedNoExceptionMatch++;
          continue;
        }

        matchedExceptions += openExceptions.rows.length;

        const existing = await client.query(
          `SELECT
             o.id,
             stn.tracking_number_raw AS tracking_number,
             o.order_date,
             wa_deadline.deadline_at AS ship_by_date,
             COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
               OR stn.is_out_for_delivery OR stn.is_delivered, false) AS is_shipped,
             o.status
           FROM orders o
           LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
           LEFT JOIN LATERAL (
             SELECT wa.deadline_at
             FROM work_assignments wa
             WHERE wa.entity_type = 'ORDER'
               AND wa.entity_id = o.id
               AND wa.work_type = 'TEST'
             ORDER BY CASE wa.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2 WHEN 'OPEN' THEN 3 WHEN 'DONE' THEN 4 ELSE 5 END,
                      wa.updated_at DESC, wa.id DESC
             LIMIT 1
           ) wa_deadline ON TRUE
           WHERE order_id = $1
           ORDER BY created_at DESC NULLS LAST, id DESC`,
          [orderId]
        );

        let affectedOrderId: number | null = null;

        if (existing.rows.length === 0) {
          const inserted_row = await client.query(
            `INSERT INTO orders (
              order_id,
              order_date,
              status,
              status_history,
              account_source,
              created_at
            ) VALUES ($1, $2, $3, $4::jsonb, $5, timezone('America/Los_Angeles', now()))
            RETURNING id`,
            [
              orderId,
              payload.orderDate,
              'shipped',
              JSON.stringify([]),
              'shipstation',
            ]
          );
          affectedOrderId = inserted_row.rows[0]?.id ?? null;
          inserted++;
        } else {
          const needsUpdate = existing.rows.some((row: any) => {
            const hasOrderDate = !!row.order_date;
            const hasShipByDate = !!row.ship_by_date;
            const status = String(row.status || '').trim().toLowerCase();
            return (
              (!hasOrderDate && payload.orderDate) ||
              (!hasShipByDate && payload.shipByDate) ||
              status === '' ||
              status === 'unassigned'
            );
          });

          affectedOrderId = existing.rows[0]?.id ?? null;

          if (!needsUpdate) {
            unchanged++;
          } else {
            await client.query(
              `UPDATE orders
               SET order_date = COALESCE($2, order_date),
                   status = CASE
                     WHEN status IS NULL OR status = '' OR status = 'unassigned' THEN 'shipped'
                     ELSE status
                   END
               WHERE order_id = $1`,
              [orderId, payload.orderDate]
            );
            updated++;
          }
        }

        // Upsert canonical ORDER/TEST deadline row in work_assignments.
        if (affectedOrderId && payload.shipByDate) {
          await client.query(
            `INSERT INTO work_assignments
               (entity_type, entity_id, work_type, assigned_tech_id, status, priority, deadline_at, notes, assigned_at, created_at, updated_at)
             VALUES ('ORDER', $1, 'TEST', NULL, 'OPEN', 100, $2::timestamptz, 'Canonical deadline row from shipstation sync', NOW(), NOW(), NOW())
             ON CONFLICT ON CONSTRAINT ux_work_assignments_active_entity DO UPDATE
               SET deadline_at = EXCLUDED.deadline_at, updated_at = NOW()
             WHERE work_assignments.status = 'OPEN'`,
            [affectedOrderId, payload.shipByDate]
          );
        }

        const exceptionIds = openExceptions.rows.map((row: any) => row.id);
        const placeholders = exceptionIds.map((_: any, i: number) => `$${i + 1}`).join(', ');
        const deleted = await client.query(
          `DELETE FROM orders_exceptions WHERE id IN (${placeholders})`,
          exceptionIds
        );
        clearedExceptions += deleted.rowCount || 0;
      }
    } finally {
      client.release();
    }

    return NextResponse.json({
      success: true,
      message: `ShipStation upload complete: inserted ${inserted}, updated ${updated}, unchanged ${unchanged}, cleared exceptions ${clearedExceptions}.`,
      fileName,
      inserted,
      updated,
      unchanged,
      matchedExceptions,
      clearedExceptions,
      skippedNoExceptionMatch,
      skippedInvalidTracking,
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
