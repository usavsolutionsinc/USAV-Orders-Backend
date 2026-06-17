import { NextRequest, NextResponse } from 'next/server';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import {
  CLAIM_TYPE_LABEL,
  type ClaimType,
} from '@/lib/zendesk-claim-template';
import { draftSellerMessageWithHermes } from '@/lib/receiving-claim-seller-assist';
import { upsertClaimSellerMessage } from '@/lib/receiving-claim-seller-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface AssistSellerRequest {
  receivingId: number;
  lineId?: number | null;
  claimType: ClaimType;
  reason?: string;
  subject: string;
  description: string;
  /** Filed ticket ref, e.g. "#5637" — required so the draft includes case context. */
  zendeskTicketNumber: string;
  zendeskTicketId?: number | null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Step-2 assist: draft ONLY the external seller/marketplace message after the
 * internal Zendesk ticket has been filed. Includes the ticket # in context.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = (await req.json().catch(() => null)) as AssistSellerRequest | null;
    if (!body) throw ApiError.badRequest('Missing body');

    const receivingId = Number(body.receivingId);
    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      throw ApiError.badRequest('Valid receivingId is required');
    }
    if (!body.claimType || !(body.claimType in CLAIM_TYPE_LABEL)) {
      throw ApiError.badRequest('Invalid claimType');
    }

    const ticketNumber = asString(body.zendeskTicketNumber);
    if (!ticketNumber) {
      throw ApiError.badRequest('zendeskTicketNumber is required — file the internal ticket first');
    }

    const subject = asString(body.subject);
    const description = asString(body.description);
    if (!subject || !description) {
      throw ApiError.badRequest('subject and description are required');
    }

    const lineId = body.lineId != null ? Number(body.lineId) : null;
    const result = await draftSellerMessageWithHermes({
      claimType: body.claimType,
      reason: body.reason,
      subject,
      description,
      zendeskTicketNumber: ticketNumber,
    });

    let sellerMessageId: number | undefined;
    try {
      const saved = await upsertClaimSellerMessage({
        orgId: ctx.organizationId,
        receivingId,
        lineId,
        sellerMessage: result.sellerMessage,
        subjectSnapshot: subject,
        model: result.model,
        zendeskTicketId: body.zendeskTicketId ?? null,
        staffId: ctx.staffId ?? null,
      });
      sellerMessageId = saved.id;
    } catch (err) {
      console.warn('[zendesk-claim/assist-seller] persist failed', err);
    }

    return NextResponse.json({
      success: true,
      sellerMessage: result.sellerMessage,
      sellerMessageId,
      linksStripped: result.linksStripped,
      model: result.model,
      degraded: result.degraded,
    });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving/zendesk-claim/assist-seller');
  }
}, { permission: 'receiving.mark_received' });
