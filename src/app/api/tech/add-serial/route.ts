import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { POST as unifiedSerial } from '@/app/api/tech/serial/route';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * Legacy POST /api/tech/add-serial — thin wrapper around POST /api/tech/serial.
 * Resolves SAL id from the latest station activity for the signed-in tech,
 * then delegates. Actor is server-derived.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });

  const techId = ctx.staffId;
  const orgId = ctx.organizationId;
  const serial = String(body.serial || body.serialNumber || '').trim();

  if (!serial) return NextResponse.json({ success: false, error: 'serial is required' }, { status: 400 });

  // Find the most recent scan SAL for this tech
  const r = await tenantQuery(
    orgId,
    `SELECT id FROM station_activity_logs
     WHERE station = 'TECH'
       AND activity_type IN ('TRACKING_SCANNED', 'FNSKU_SCANNED')
       AND staff_id = $1
       AND organization_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [techId, orgId],
  );
  const salId = r.rows[0]?.id ?? null;

  if (!salId) {
    return NextResponse.json({ success: false, error: 'No active scan session found' }, { status: 404 });
  }

  const headers = new Headers(req.headers);
  headers.set('Content-Type', 'application/json');
  const syntheticReq = new NextRequest(req.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'add', salId, serial, techId }),
  });

  return unifiedSerial(syntheticReq, { params: Promise.resolve({}) });
}, { permission: 'tech.scan_serial' });
