import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getMutationTrustStats } from '@/lib/assistant/mutations/trust-stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/assistant/mutations/stats — per-kind accept/reject stats for the
 * org's agent_mutations (universal-feed plan Phase 5). Read-only evidence for
 * trust-list widening; the widening itself is a reviewed registry PR. Gated on
 * studio.manage (same as the AI write routes it reports on). org from ctx.
 */
export const GET = withAuth(
  async (_req: NextRequest, ctx) => {
    const stats = await getMutationTrustStats(ctx.organizationId);
    return NextResponse.json({ success: true, stats });
  },
  { permission: 'studio.manage' },
);
