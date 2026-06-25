import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { originateCall, NextivaNotConfiguredError } from '@/lib/voice/nextiva/client';

export const dynamic = 'force-dynamic';

/**
 * POST /api/integrations/nextiva/call  { to, fromExtension?, voicemailId? }
 * Click-to-call: originate from the agent's Nextiva extension to a customer.
 */

const Body = z.object({
  to: z.string().trim().min(3).max(32),
  fromExtension: z.string().trim().max(16).optional(),
  voicemailId: z.number().int().positive().optional(),
});

export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const json = await req.json().catch(() => null);
      if (!json) throw ApiError.badRequest('Missing JSON body');
      const { to, fromExtension, voicemailId } = Body.parse(json);

      const result = await originateCall(ctx.organizationId, { to, fromExtension });

      await recordAudit(pool, ctx, req, {
        source: 'api',
        action: AUDIT_ACTION.VOICE_CALL_ORIGINATED,
        entityType: AUDIT_ENTITY.CALL_EVENT,
        entityId: result.externalCallId ?? voicemailId ?? to,
        after: { to, externalCallId: result.externalCallId ?? null, voicemailId: voicemailId ?? null },
      });

      return NextResponse.json({ success: true, externalCallId: result.externalCallId ?? null });
    } catch (err) {
      if (err instanceof NextivaNotConfiguredError) {
        return NextResponse.json({ error: 'NEXTIVA_NOT_CONNECTED' }, { status: 501 });
      }
      return errorResponse(err, 'POST /api/integrations/nextiva/call');
    }
  },
  { permission: 'integrations.zendesk' },
);
