import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { POST as unifiedSerial } from '@/app/api/tech/serial/route';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * Legacy POST /api/tech/update-serials — thin wrapper around POST /api/tech/serial.
 * Resolves SAL id from tracking/fnskuLogId, then delegates to the unified endpoint.
 * Actor is server-derived from the verified session.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });

  const tracking = String(body.tracking || '').trim();
  const fnskuLogId = body.fnskuLogId ? Number(body.fnskuLogId) : null;
  const techId = ctx.staffId;
  const serialNumbers: string[] = Array.isArray(body.serialNumbers) ? body.serialNumbers : [];

  // Resolve salId from fnskuLogId or tracking
  let salId: number | null = null;

  if (fnskuLogId) {
    const r = await pool.query(
      `SELECT station_activity_log_id FROM fba_fnsku_logs WHERE id = $1 LIMIT 1`,
      [fnskuLogId],
    );
    salId = r.rows[0]?.station_activity_log_id ?? null;
  }

  if (!salId && tracking) {
    // Find most recent TECH SAL for this tracking
    const r = await pool.query(
      `SELECT sal.id FROM station_activity_logs sal
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
       WHERE sal.station = 'TECH'
         AND sal.activity_type IN ('TRACKING_SCANNED', 'FNSKU_SCANNED')
         AND (
           sal.scan_ref = $1
           OR sal.fnsku = $1
           OR stn.tracking_number_raw = $1
           OR UPPER(TRIM(stn.tracking_number_normalized)) = UPPER(TRIM($1))
         )
       ORDER BY sal.created_at DESC LIMIT 1`,
      [tracking],
    );
    salId = r.rows[0]?.id ?? null;
  }

  if (!salId) {
    return NextResponse.json({ success: false, error: 'Could not resolve scan session for tracking' }, { status: 404 });
  }

  const headers = new Headers(req.headers);
  headers.set('Content-Type', 'application/json');
  const syntheticReq = new NextRequest(req.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'update',
      salId,
      serials: serialNumbers,
      techId,
    }),
  });

  return unifiedSerial(syntheticReq, { params: Promise.resolve({}) });
}, { permission: 'tech.scan_serial' });
