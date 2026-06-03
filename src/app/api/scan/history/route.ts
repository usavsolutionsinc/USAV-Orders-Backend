import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { mapScanToDesktopRoute } from '@/lib/scan-history-route';

/**
 * GET /api/scan/history?limit=20
 *
 * Returns the signed-in staff's most recent receiving Data Matrix scans
 * (R-/L-/U- labels) made from the phone (/m/scan). Powers the "Scans" section
 * of the desktop phone-history popover — scan on the phone, see it here.
 *
 * Staff scoping is enforced server-side: the staff id comes from the verified
 * `usav_sid` session (ctx.staffId), NEVER from the request. The source data is
 * `mobile_scan_events`, which the resolver already writes on every scan.
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(req.url);
    const rawLimit = Number(searchParams.get('limit') ?? '20');
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50)
      : 20;

    const result = await pool.query(
      `SELECT id, raw_value, kind, routed_to, created_at
         FROM mobile_scan_events
        WHERE staff_id = $1
          AND (routed_to LIKE '/m/r/%'
            OR routed_to LIKE '/m/l/%'
            OR routed_to LIKE '/m/u/%')
        ORDER BY id DESC
        LIMIT $2`,
      [ctx.staffId, limit],
    );

    const entries = result.rows
      .map((row: any) => {
        const mapped = mapScanToDesktopRoute(row.routed_to);
        if (!mapped) return null;
        return {
          id: row.id as number,
          rawValue: row.raw_value as string,
          kind: row.kind as string,
          scannedAt: row.created_at as string,
          type: mapped.type,
          typeLabel: mapped.typeLabel,
          desktopHref: mapped.desktopHref,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ entries });
  } catch (error: any) {
    console.error('[scan/history] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch scan history', details: error?.message },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.view' });
