import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getPrintHistoryForUnit } from '@/lib/labels/print-jobs';
import type { OrgId } from '@/lib/tenancy/constants';

export const dynamic = 'force-dynamic';

/**
 * GET /api/serial-units/[id]/print-history
 *
 * Ordered (newest-first) label print jobs for a serial unit — the read side of
 * the `label_print_jobs` ledger. Proves reprint-vs-first-issue and surfaces the
 * exact DataMatrix payload that was on each sticker. Org-scoped. Auth:
 * `print.label`.
 */
export const GET = withAuth(
  async (request, ctx) => {
    const segments = request.nextUrl.pathname.split('/').filter(Boolean);
    // .../api/serial-units/[id]/print-history → id is segments[-2]
    const serialUnitId = Number(segments[segments.length - 2]);
    if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
      return NextResponse.json({ ok: false, error: 'invalid serial_unit id' }, { status: 400 });
    }

    const limitRaw = Number(request.nextUrl.searchParams.get('limit'));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;

    try {
      const jobs = await getPrintHistoryForUnit(serialUnitId, ctx.organizationId as OrgId, limit);
      return NextResponse.json({ ok: true, jobs });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'print-history failed';
      console.error('[GET /api/serial-units/[id]/print-history] error:', err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'print.label' },
);
