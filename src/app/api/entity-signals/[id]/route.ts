import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { getEntitySignal } from '@/lib/surfaces/entity-signals-read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/entity-signals/[id] — one signal's full detail for the Workbench
 * inspector (universal-feed plan Phase 5). Org-scoped (org from ctx); 404 when
 * absent or not this org's. Gated operations.view.
 */
export async function GET(req: NextRequest) {
  const gate = await requireRoutePerm(req, 'operations.view');
  if (gate.denied) return gate.denied;
  const ctx = gate.ctx;

  const segments = req.nextUrl.pathname.split('/').filter(Boolean);
  const id = Number(segments[segments.length - 1]);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ success: false, error: 'invalid signal id' }, { status: 400 });
  }

  const signal = await getEntitySignal(ctx.organizationId, id);
  if (!signal) return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
  return NextResponse.json({ success: true, signal });
}
