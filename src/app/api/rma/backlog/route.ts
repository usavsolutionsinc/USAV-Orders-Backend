import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { listDispositionBacklog } from '@/lib/rma/authorizations';

/**
 * GET /api/rma/backlog
 *
 * The disposition worklist (returns-unification Stage 4): serial units sitting
 * at RETURNED that have never received a disposition (`return_dispositions`
 * has no row for them yet) — see `listDispositionBacklog()` for why this is
 * NOT just `current_status = 'RETURNED'`. Oldest-first, read-only.
 *
 * Query: ?limit=100 (optional, default 100)
 */
export const GET = withAuth(async (request, ctx) => {
  const limitRaw = request.nextUrl.searchParams.get('limit');
  const limitParsed = limitRaw != null ? Number(limitRaw) : NaN;
  const limit = Number.isFinite(limitParsed) && limitParsed > 0 ? Math.min(limitParsed, 500) : 100;

  try {
    const backlog = await listDispositionBacklog(ctx.organizationId, limit);
    return NextResponse.json({ ok: true, backlog });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'list disposition backlog failed';
    console.error('[GET /api/rma/backlog] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'rma.view' });
