import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { resolveShipmentId } from '@/lib/shipping/resolve';

function normalizeSerialList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim().toUpperCase())
    .filter(Boolean);
}

function detectSerialType(
  serials: string[],
  existingType: string | null | undefined,
  accountSource: string | null | undefined
) {
  if (existingType) return existingType;
  if (accountSource === 'fba') return 'FNSKU';
  return serials.some((serial) => /^X0|^B0/i.test(serial)) ? 'FNSKU' : 'SERIAL';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tracking = String(body?.tracking || '').trim();
    const serialNumbers = normalizeSerialList(body?.serialNumbers);
    const parsedTechId = Number.parseInt(String(body?.techId || ''), 10);
    const techId = Number.isFinite(parsedTechId) && parsedTechId > 0 ? parsedTechId : null;

    if (!tracking) {
      return NextResponse.json({ success: false, error: 'Tracking number is required' }, { status: 400 });
    }

    const key18 = normalizeTrackingKey18(tracking);
    if (!key18 || key18.length < 8) {
      return NextResponse.json({ success: false, error: 'Invalid tracking number' }, { status: 400 });
    }

    const { shipmentId: resolvedShipmentId, scanRef: resolvedScanRef } = await resolveShipmentId(tracking);

    let existingRowResult = await pool.query(
      `SELECT id, serial_type, tested_by
       FROM tech_serial_numbers
       WHERE (shipment_id IS NOT NULL AND shipment_id = $1)
          OR (shipment_id IS NULL AND scan_ref IS NOT NULL AND scan_ref = $2)
       ORDER BY id ASC
       LIMIT 1`,
      [resolvedShipmentId, resolvedScanRef]
    );

    const orderResult = await pool.query(
      `SELECT o.account_source
       FROM orders o
       JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
       WHERE RIGHT(regexp_replace(UPPER(stn.tracking_number_raw), '[^A-Z0-9]', '', 'g'), 18) = $1
       ORDER BY o.id DESC
       LIMIT 1`,
      [key18]
    );
    const exceptionResult = await pool.query(
      `SELECT id
       FROM orders_exceptions
       WHERE status = 'open'
         AND RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
       ORDER BY id DESC
       LIMIT 1`,
      [key18]
    );
    const ordersExceptionId = exceptionResult.rows[0]?.id ? Number(exceptionResult.rows[0].id) : null;

    if (existingRowResult.rows.length === 0 && ordersExceptionId) {
      existingRowResult = await pool.query(
        `SELECT id, serial_type, tested_by
         FROM tech_serial_numbers
         WHERE orders_exception_id = $1
         ORDER BY id ASC
         LIMIT 1`,
        [ordersExceptionId]
      );
    }

    const joinedSerials = serialNumbers.join(', ');

    if (existingRowResult.rows.length > 0) {
      const row = existingRowResult.rows[0];
      const nextTestedBy = techId ?? (row.tested_by ? Number(row.tested_by) : null);
      await pool.query(
        `UPDATE tech_serial_numbers
         SET serial_number = $1,
             serial_type = $2,
             updated_at = date_trunc('second', NOW()),
             tested_by = $3,
             orders_exception_id = CASE
               WHEN $5::int IS NOT NULL THEN COALESCE(orders_exception_id, $5)
               ELSE orders_exception_id
             END
         WHERE id = $4`,
        [
          joinedSerials,
          detectSerialType(serialNumbers, row.serial_type, orderResult.rows[0]?.account_source),
          nextTestedBy,
          row.id,
          ordersExceptionId,
        ]
      );
    } else if (serialNumbers.length > 0) {
      await pool.query(
        `INSERT INTO tech_serial_numbers
         (shipment_id, orders_exception_id, scan_ref, serial_number, serial_type, tested_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          resolvedShipmentId,
          ordersExceptionId,
          resolvedScanRef,
          joinedSerials,
          detectSerialType(serialNumbers, null, orderResult.rows[0]?.account_source),
          techId,
        ]
      );
    }

    await invalidateCacheTags(['tech-logs', 'orders-next', 'shipped', 'orders']);

    return NextResponse.json({
      success: true,
      serialNumbers,
    });
  } catch (error: any) {
    console.error('Error updating serials:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update serials',
        details: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
