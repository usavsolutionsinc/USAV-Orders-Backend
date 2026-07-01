import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { findByNumber } from '@/lib/rma/authorizations';

/**
 * GET /api/rma/by-number/[number]
 *
 * Lookup an RMA by its `RMA-YYYY-NNNNN` code. 404 if not found.
 */
export const GET = withAuth(async (request, ctx) => {
  const orgId = ctx.organizationId;
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const numberRaw = segments[segments.length - 1];
  const rmaNumber = decodeURIComponent(numberRaw || '').trim();
  if (!rmaNumber) {
    return NextResponse.json({ ok: false, error: 'invalid rma number' }, { status: 400 });
  }
  try {
    const rma = await findByNumber(rmaNumber, orgId);
    if (!rma) return NextResponse.json({ ok: false, error: 'rma not found' }, { status: 404 });
    return NextResponse.json({ ok: true, rma });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'lookup failed';
    console.error('[GET /api/rma/by-number] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'rma.view' });
