import { NextRequest, NextResponse } from 'next/server';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import {
  countPendingNasMirror,
  isNasMirrorConfigured,
  runNasBackupBatch,
} from '@/lib/photos/mirror-nas';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /api/photos/nas-backup — NAS mirror status for the photo library UI.
 * POST /api/photos/nas-backup — enqueue + run one backup batch (GCS → office NAS).
 *
 * Uses the same NAS agent tunnel as Zendesk claim archive and shipping labels —
 * not the Caddy browse URL (that path is read-only from the browser).
 */
export const GET = withAuth(async (_req, ctx) => {
  try {
    const remaining = await countPendingNasMirror(ctx.organizationId);
    return NextResponse.json({
      agentConfigured: isNasMirrorConfigured(),
      pendingMirror: remaining,
    });
  } catch (error) {
    return errorResponse(error, 'GET /api/photos/nas-backup');
  }
}, { permission: 'photos.view' });

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    if (!isNasMirrorConfigured()) {
      throw ApiError.badRequest(
        'NAS backup agent is not configured (NAS_AGENT_URL / NAS_AGENT_TOKEN on Vercel)',
      );
    }

    const body = (await req.json().catch(() => ({}))) as { limit?: number };
    const result = await runNasBackupBatch({
      organizationId: ctx.organizationId,
      limit: body.limit,
      skipAgeGate: true,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return errorResponse(error, 'POST /api/photos/nas-backup');
  }
}, { permission: 'photos.view' });
