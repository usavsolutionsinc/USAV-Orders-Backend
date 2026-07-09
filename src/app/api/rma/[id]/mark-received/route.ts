import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { markReceived } from '@/lib/rma/authorizations';

/**
 * POST /api/rma/[id]/mark-received
 *
 * AUTHORIZED → RECEIVED. Returns 409 if the RMA is not in AUTHORIZED.
 */
export const POST = withAuth(async (request, ctx) => {
  if (typeof ctx.staffId !== 'number' || ctx.staffId <= 0) {
    return NextResponse.json({ ok: false, error: 'authenticated staff required' }, { status: 401 });
  }

  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const idStr = segments[segments.length - 2];
  const rmaId = Number(idStr);
  if (!Number.isFinite(rmaId) || rmaId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid rma id' }, { status: 400 });
  }

  try {
    const result = await markReceived({ rmaId }, ctx.organizationId);
    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'mark-received failed';
    console.error('[POST /api/rma/[id]/mark-received] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'rma.manage' });
