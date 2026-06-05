/**
 * POST /api/receiving/zendesk-claim/classify
 *
 * Suggest a claim type + severity from the operator's "what happened" note
 * (roadmap B2). Suggestion only — the modal pre-fills its pickers and the
 * operator confirms or overrides before filing.
 *
 * Body: { reason: string }
 * Returns: { success, claimType, severity, confidence, model }
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import { classifyClaimWithLlm } from '@/lib/zendesk-claim-classify-llm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ClassifyRequest {
  reason?: string;
}

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = (await req.json().catch(() => null)) as ClassifyRequest | null;
    const reason = String(body?.reason ?? '').trim();
    if (!reason) throw ApiError.badRequest('reason is required to classify');

    const result = await classifyClaimWithLlm(reason);
    return NextResponse.json({
      success: true,
      claimType: result.claimType,
      severity: result.severity,
      confidence: result.confidence,
      model: result.model,
    });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving/zendesk-claim/classify');
  }
}, { permission: 'receiving.mark_received' });
