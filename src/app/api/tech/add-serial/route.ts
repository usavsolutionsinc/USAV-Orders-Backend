import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { POST as unifiedSerial } from '@/app/api/tech/serial/route';

/**
 * Legacy POST /api/tech/add-serial — thin wrapper around POST /api/tech/serial.
 * Resolves SAL id from the latest station activity for this tech, then delegates.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });

  const techId = body.techId ? Number(body.techId) : null;
  const serial = String(body.serial || body.serialNumber || '').trim();

  if (!techId) return NextResponse.json({ success: false, error: 'techId is required' }, { status: 400 });
  if (!serial) return NextResponse.json({ success: false, error: 'serial is required' }, { status: 400 });

  // Find the most recent scan SAL for this tech
  const r = await pool.query(
    `SELECT id FROM station_activity_logs
     WHERE station = 'TECH'
       AND activity_type IN ('TRACKING_SCANNED', 'FNSKU_SCANNED')
       AND staff_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [techId],
  );
  const salId = r.rows[0]?.id ?? null;

  if (!salId) {
    return NextResponse.json({ success: false, error: 'No active scan session found' }, { status: 404 });
  }

  const syntheticReq = new NextRequest(req.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'add', salId, serial, techId }),
  });

  return unifiedSerial(syntheticReq);
}
