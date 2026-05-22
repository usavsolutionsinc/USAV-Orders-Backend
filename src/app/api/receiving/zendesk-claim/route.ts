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
 * item / vendor defect). Uses the existing GAS Web App bridge (same one
 * powering `createZendeskTicket` in src/lib/zendesk.ts) so we share the
 * same email-relay infrastructure as the repair flow.
 *
 * If the operator edited the subject/body in the modal, those values are
 * sent verbatim. Otherwise the template builder fills them from PO/tracking/
 * photos/line context.
 */
export const POST = withAuth(async (req: NextRequest) => {
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

    const gasUrl = process.env.ZendeskTicketMailer_GAS_WebappURL;
    if (!gasUrl) {
      return NextResponse.json({
        success: false,
        error: 'Zendesk bridge not configured',
        draftBody: description,
      }, { status: 503 });
    }

    const payload = {
      subject,
      description,
      customerName: 'USAV Receiving',
      customerEmail: '',
    };

    let ticketNumber: string | null = null;
    try {
      const gasRes = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!gasRes.ok) {
        return NextResponse.json({
          success: false,
          error: `Zendesk bridge HTTP ${gasRes.status}`,
          draftBody: description,
        }, { status: 502 });
      }
      const result = await gasRes.json().catch(() => null);
      if (!result?.ok) {
        return NextResponse.json({
          success: false,
          error: result?.error || 'Bridge rejected request',
          draftBody: description,
        }, { status: 502 });
      }
      const raw =
        result.ticketNumber ?? result.ticket_number ?? result.ticketId ?? result.ticket_id ?? result.id;
      ticketNumber = raw == null
        ? null
        : (String(raw).startsWith('#') ? String(raw) : `#${raw}`);
    } catch (err: unknown) {
      return NextResponse.json({
        success: false,
        error: err instanceof Error ? err.message : 'Bridge request failed',
        draftBody: description,
      }, { status: 502 });
    }

    return NextResponse.json({ success: true, ticketNumber });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving/zendesk-claim');
  }
}, { permission: 'receiving.mark_received' });
