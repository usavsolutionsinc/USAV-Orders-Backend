import { NextRequest, NextResponse } from 'next/server';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import {
  buildReceivingClaimTemplate,
  CLAIM_TYPE_LABEL,
  type ClaimType,
} from '@/lib/zendesk-claim-template';
import { poReceivingLink } from '@/lib/receiving-claim-photos';

export const dynamic = 'force-dynamic';

interface PreviewRequest {
  receivingId: number;
  lineId?: number | null;
  claimType: ClaimType;
  reason?: string;
}

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId;
    const body = (await req.json().catch(() => null)) as PreviewRequest | null;
    if (!body) throw ApiError.badRequest('Missing body');

    const receivingId = Number(body.receivingId);
    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      throw ApiError.badRequest('Valid receivingId is required');
    }
    if (!body.claimType || !(body.claimType in CLAIM_TYPE_LABEL)) {
      throw ApiError.badRequest('Invalid claimType');
    }
    const lineId = body.lineId != null ? Number(body.lineId) : null;

    // Org-scope the template build: it reads tenant-owned receiving /
    // receiving_lines (PO#, tracking, item_name, condition, source_platform).
    // Passing orgId adds AND organization_id=$ to both reads and turns a
    // cross-tenant receivingId/lineId into a 'Receiving not found' (404).
    const template = await buildReceivingClaimTemplate({
      receivingId,
      lineId,
      claimType: body.claimType,
      reason: body.reason,
      poReceivingLink: poReceivingLink(req, receivingId),
    }, orgId);

    return NextResponse.json({ success: true, ...template });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving/zendesk-claim/preview');
  }
}, { permission: 'receiving.mark_received' });
