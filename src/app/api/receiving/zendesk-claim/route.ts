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
import { createTicket, ZendeskNotConfiguredError } from '@/lib/zendesk';
import { buildExternalId, linkTicket } from '@/lib/zendesk-links';

export const dynamic = 'force-dynamic';

interface ClaimRequest {
  receivingId: number;
  lineId?: number | null;
  claimType: ClaimType;
  severity: ClaimSeverity;
  reason?: string;
  /** Operator-edited subject. When omitted, the server builds from template. */
  subject?: string;
  /** Operator-edited body. When omitted, the server builds from template. */
  description?: string;
}

/**
 * Create a Zendesk ticket for a receiving claim (damage / missing / wrong
 * item / vendor defect) directly via the Zendesk REST API
 * (`createTicket` in src/lib/zendesk.ts).
 *
 * If the operator edited the subject/body in the modal, those values are
 * sent verbatim. Otherwise the template builder fills them from PO/tracking/
 * photos/line context.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = (await req.json().catch(() => null)) as ClaimRequest | null;
    if (!body) throw ApiError.badRequest('Missing body');

    const receivingId = Number(body.receivingId);
    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      throw ApiError.badRequest('Valid receivingId is required');
    }

    const claimType = body.claimType;
    if (!claimType || !(claimType in CLAIM_TYPE_LABEL)) {
      throw ApiError.badRequest('Invalid claimType');
    }
    const severity = body.severity ?? 'medium';
    if (!(severity in CLAIM_SEVERITY_LABEL)) {
      throw ApiError.badRequest('Invalid severity');
    }
    const lineId = body.lineId != null ? Number(body.lineId) : null;

    const editedSubject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const editedDescription = typeof body.description === 'string' ? body.description.trim() : '';

    let subject: string;
    let description: string;
    if (editedSubject && editedDescription) {
      subject = editedSubject;
      description = editedDescription;
    } else {
      const template = await buildReceivingClaimTemplate({
        receivingId,
        lineId,
        claimType,
        severity,
        reason: body.reason,
      });
      subject = editedSubject || template.subject;
      description = editedDescription || template.description;
    }

    const entityType = lineId != null ? 'RECEIVING_LINE' : 'RECEIVING';
    const entityId = lineId != null ? lineId : receivingId;

    // Create the ticket directly via the Zendesk REST API. external_id is set at
    // creation time so the support workspace can resolve this claim's Blob photos.
    let ticket;
    try {
      ticket = await createTicket({
        subject,
        comment: { body: description, public: false },
        type: 'task',
        tags: ['receiving_claim', `claim_${claimType}`],
        external_id: buildExternalId(entityType, entityId),
      });
    } catch (err: unknown) {
      if (err instanceof ZendeskNotConfiguredError) {
        return NextResponse.json({
          success: false,
          error: 'Zendesk is not configured',
          draftBody: description,
        }, { status: 503 });
      }
      return NextResponse.json({
        success: false,
        error: err instanceof Error ? err.message : 'Zendesk request failed',
        draftBody: description,
      }, { status: 502 });
    }

    const ticketNumber = `#${ticket.id}`;

    // Write the ticket→entity link row (the support workspace prefers ticket_links
    // over external_id). Best-effort: the ticket already exists, so a failure here
    // must not turn a successful claim into an error.
    try {
      await linkTicket({
        orgId: ctx.organizationId,
        zendeskTicketId: ticket.id,
        entityType,
        entityId,
        staffId: ctx.staffId,
      });
    } catch (linkErr) {
      console.warn('[POST /api/receiving/zendesk-claim] ticket link backfill failed', linkErr);
    }

    return NextResponse.json({ success: true, ticketNumber });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving/zendesk-claim');
  }
}, { permission: 'receiving.mark_received' });
