import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import {
  getSourcingAnalytics,
  type SourcingAnalyticsRange,
} from '@/lib/neon/sourcing-queries';

const RANGES: readonly SourcingAnalyticsRange[] = ['30d', '90d', '1y'];

function parseRange(raw: string | null): SourcingAnalyticsRange {
  return (RANGES as readonly string[]).includes(raw ?? '') ? (raw as SourcingAnalyticsRange) : '90d';
}

/**
 * GET /api/sourcing/analytics?range=30d|90d|1y — org-scoped sourcing rollup
 * for the hub's Analytics mode (Monitor archetype: pure read, no persistence).
 * Spend/acquisitions per week, fill-rate inputs, time-to-source, and per-SKU
 * acquisition cost vs the catalog target/baseline.
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(req.url);
    const range = parseRange(searchParams.get('range'));
    const analytics = await getSourcingAnalytics(range, ctx.organizationId);
    return NextResponse.json({ success: true, analytics });
  } catch (error: any) {
    console.error('Error in GET /api/sourcing/analytics:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to load sourcing analytics' },
      { status: 500 },
    );
  }
}, { permission: 'sourcing.view', feature: 'sourcing' });
