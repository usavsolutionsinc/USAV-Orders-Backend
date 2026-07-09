import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { linkVoicemailToTicket } from '@/lib/voice/voicemail-mutations';

export const dynamic = 'force-dynamic';

/**
 * POST /api/voicemails/:id/link  { ticketId: number | null }
 * Link (or, with null, unlink) a voicemail to a Zendesk ticket via ticket_links.
 */

function voicemailIdFromUrl(req: NextRequest): number {
  const segs = req.nextUrl.pathname.split('/').filter(Boolean);
  const i = segs.lastIndexOf('link');
  const id = Number(decodeURIComponent(segs[i - 1] || ''));
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('A valid numeric voicemail id is required');
  return id;
}

const Body = z.object({ ticketId: z.number().int().positive().nullable() });

export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const id = voicemailIdFromUrl(req);
      const json = await req.json().catch(() => null);
      if (!json) throw ApiError.badRequest('Missing JSON body');
      const { ticketId } = Body.parse(json);

      const result = await linkVoicemailToTicket(ctx.organizationId, id, ticketId, ctx.staffId);
      if (result.notFound) throw ApiError.notFound('Voicemail', id);

      await recordAudit(pool, ctx, req, {
        source: 'api',
        action: AUDIT_ACTION.VOICEMAIL_LINKED,
        entityType: AUDIT_ENTITY.VOICEMAIL,
        entityId: id,
        after: { linkedTicketId: result.linkedTicketId },
      });

      return NextResponse.json({ success: true, linkedTicketId: result.linkedTicketId });
    } catch (err) {
      return errorResponse(err, 'POST /api/voicemails/[id]/link');
    }
  },
  { permission: 'integrations.zendesk' },
);
