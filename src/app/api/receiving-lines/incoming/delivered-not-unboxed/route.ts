/**
 * GET /api/receiving-lines/incoming/delivered-not-unboxed
 *
 * Carrier-delivered cartons that have not been unboxed yet (qty=0, unboxed_at
 * null). Includes dock-scanned-but-not-unboxed — unlike view=incoming which
 * drops scanned rows. Complements delivered-unscanned (not scanned).
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import {
  listDeliveredNotUnboxed,
  DELIVERED_NOT_UNBOXED_WINDOW_DAYS,
} from '@/lib/receiving/delivered-not-unboxed';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  try {
    const items = await listDeliveredNotUnboxed(ctx.organizationId);
    return NextResponse.json({
      success: true,
      count: items.length,
      window_days: DELIVERED_NOT_UNBOXED_WINDOW_DAYS,
      items,
    });
  } catch (err) {
    console.error('[incoming/delivered-not-unboxed]', err);
    return NextResponse.json({ success: false, error: 'Failed to load delivered-not-unboxed' }, { status: 500 });
  }
}, { permission: 'receiving.view' });
