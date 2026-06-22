import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getSerialTrace } from '@/lib/audit-log/trace-aggregator';

/**
 * GET /api/audit-log/trace?serial=<value>
 *
 * First-Trace (P1-TRACE-03): the full cross-station lifecycle of ONE physical
 * unit, anchored on its serial (or minted unit_uid) — receiving → testing →
 * putaway → pick → pack → label → ship → return, each with actor + timestamp.
 *
 * Read-only, org-scoped (a serial never resolves another tenant's unit).
 * Gate: admin.view_logs (matches the rest of the audit-log surface).
 */
export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    const serial = req.nextUrl.searchParams.get('serial')?.trim() || '';
    if (!serial) {
      return NextResponse.json(
        { success: false, error: 'serial query param is required' },
        { status: 400 },
      );
    }
    try {
      const trace = await getSerialTrace(serial, ctx.organizationId);
      return NextResponse.json({ success: true, ...trace });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'audit-log/trace read failed';
      console.error('audit-log/trace GET failed:', err);
      return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }
  },
  { permission: 'admin.view_logs' },
);
