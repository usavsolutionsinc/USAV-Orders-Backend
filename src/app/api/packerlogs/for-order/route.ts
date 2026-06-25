import { NextRequest, NextResponse } from 'next/server';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import { findPackerLogForOrder } from '@/lib/packer/find-packer-log-for-order';

export const dynamic = 'force-dynamic';

/**
 * Resolve the existing (already pack-completed) packer_log for an order so the
 * mobile pack flow can attach in-flow photos to it. Read-only — never creates a
 * pack record.
 *
 *   GET ?orderRowId=N → { packerLogId: number | null }
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orderRowId = Number(new URL(req.url).searchParams.get('orderRowId'));
    if (!Number.isFinite(orderRowId) || orderRowId <= 0) {
      throw ApiError.badRequest('Valid orderRowId is required');
    }

    const packerLogId = await findPackerLogForOrder(ctx.organizationId, orderRowId);
    return NextResponse.json({ packerLogId });
  } catch (error) {
    return errorResponse(error, 'GET /api/packerlogs/for-order');
  }
}, { permission: 'packing.view' });
