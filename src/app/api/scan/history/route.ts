import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
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

    // `mobile_scan_events` has no organization_id column (child-scoped to
    // staff), so isolation is enforced two ways: (1) GUC-wrap via tenantQuery
    // so the row is read under the org session, and (2) require the owning
    // staff row to belong to this org via an EXISTS subquery against the
    // tenant-owned `staff` table — a cross-tenant staff id can never surface.
    const result = await tenantQuery(
      ctx.organizationId,
      `SELECT mse.id, mse.raw_value, mse.kind, mse.routed_to, mse.created_at
         FROM mobile_scan_events mse
        WHERE mse.staff_id = $1
          AND EXISTS (
            SELECT 1 FROM staff s
             WHERE s.id = mse.staff_id
               AND s.organization_id = $3
          )
          AND (mse.routed_to LIKE '/m/r/%'
            OR mse.routed_to LIKE '/m/l/%'
            OR mse.routed_to LIKE '/m/u/%')
        ORDER BY mse.id DESC
        LIMIT $2`,
      [ctx.staffId, limit, ctx.organizationId],
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
          // `routed_to` is already the mobile route the scan resolved to
          // (/m/r/…, /m/l/…, /m/u/…) — surface it so the mobile dashboard's
          // Recent Activity can deep-link back into the phone flow.
          mobileHref: (row.routed_to as string) || mapped.desktopHref,
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
