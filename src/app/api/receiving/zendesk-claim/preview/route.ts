import { NextRequest, NextResponse } from 'next/server';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import {
  buildReceivingClaimTemplate,
  CLAIM_SEVERITY_LABEL,
  CLAIM_TYPE_LABEL,
  type ClaimSeverity,
  type ClaimType,
} from '@/lib/zendesk-claim-template';

export const dynamic = 'force-dynamic';

interface PreviewRequest {
  receivingId: number;
  lineId?: number | null;
  claimType: ClaimType;
  severity: ClaimSeverity;
  reason?: string;
}

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = (await req.json().catch(() => null)) as PreviewRequest | null;
    if (!body) throw ApiError.badRequest('Missing body');

    const receivingId = Number(body.receivingId);
    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      throw ApiError.badRequest('Valid receivingId is required');
    }
    if (!body.claimType || !(body.claimType in CLAIM_TYPE_LABEL)) {
      throw ApiError.badRequest('Invalid claimType');
    }
    const severity = body.severity ?? 'medium';
    if (!(severity in CLAIM_SEVERITY_LABEL)) {
      throw ApiError.badRequest('Invalid severity');
    }
    const lineId = body.lineId != null ? Number(body.lineId) : null;

    const template = await buildReceivingClaimTemplate({
      receivingId,
      lineId,
      claimType: body.claimType,
      severity,
      reason: body.reason,
    });

    return NextResponse.json({ success: true, ...template });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving/zendesk-claim/preview');
  }
}, { permission: 'receiving.mark_received' });
