/**
 * POST /api/receiving/zendesk-claim/draft
 *
 * AI-drafting companion to the /preview endpoint (roadmap item A1). Builds
 * the same deterministic claim template, then asks the local Hermes model to
 * rewrite it into a clearer, professional subject + body. The result is a
 * DRAFT: the operator reviews and edits it in the modal before any ticket is
 * filed.
 *
 * Fact safety: we verify the model preserved the PO and tracking references
 * from the template. If it dropped or mangled them, we fall back to the
 * deterministic template (and flag `degraded`) rather than send a draft that
 * lost its facts.
 */

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
import { draftClaimWithLlm } from '@/lib/zendesk-claim-draft-llm';
import { poReceivingLink } from '@/lib/receiving-claim-photos';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface DraftRequest {
  receivingId: number;
  lineId?: number | null;
  claimType: ClaimType;
  severity: ClaimSeverity;
  reason?: string;
}

/** Pull a "Label: value" line out of the deterministic template body. */
function templateRef(description: string, label: string): string | null {
  const m = description.match(new RegExp(`^${label}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = (await req.json().catch(() => null)) as DraftRequest | null;
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
      poReceivingLink: poReceivingLink(req, receivingId),
    });

    const draft = await draftClaimWithLlm({
      claimTypeLabel: CLAIM_TYPE_LABEL[body.claimType],
      severityLabel: CLAIM_SEVERITY_LABEL[severity],
      template,
      reason: body.reason,
    });

    // Fact guard: the rewrite must keep the PO and tracking references. A
    // tracking value of "n/a" is a non-fact, so it never trips the guard.
    const poRef = templateRef(template.description, 'Purchase Order');
    const trackingRef = templateRef(template.description, 'Tracking');
    const keptPo = !poRef || draft.description.includes(poRef);
    const keptTracking =
      !trackingRef || trackingRef === 'n/a' || draft.description.includes(trackingRef);

    if (!keptPo || !keptTracking) {
      // Don't ship a draft that lost its facts — hand back the template.
      return NextResponse.json({
        success: true,
        degraded: true,
        subject: template.subject,
        description: template.description,
        model: draft.model,
      });
    }

    return NextResponse.json({
      success: true,
      degraded: false,
      subject: draft.subject,
      description: draft.description,
      model: draft.model,
    });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving/zendesk-claim/draft');
  }
}, { permission: 'receiving.mark_received' });
