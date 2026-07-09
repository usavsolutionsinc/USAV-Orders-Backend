import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import {
  formatSupportTicketDisplayLabel,
  getPrimarySupportTicketForReceiving,
  normalizeReceivingTicketEntityRefs,
} from '@/lib/support/tickets';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';

export const dynamic = 'force-dynamic';

const Query = z.object({
  // Placeholder unfound rows use lineId = -receiving_id; normalized before lookup.
  lineId: z.coerce.number().int().optional(),
  receivingId: z.coerce.number().int().positive().optional(),
});

/**
 * GET /api/support/tickets/by-entity?lineId=&receivingId=
 * Primary support ticket for a receiving carton/line — label matches the media
 * library claims chip (#9395 for Zendesk tickets).
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const context = 'GET /api/support/tickets/by-entity';
  try {
    const sp = req.nextUrl.searchParams;
    const parsed = Query.parse({
      lineId: sp.get('lineId') ?? undefined,
      receivingId: sp.get('receivingId') ?? undefined,
    });
    const { lineId, receivingId } = normalizeReceivingTicketEntityRefs(parsed);
    if (lineId == null && receivingId == null) {
      return NextResponse.json(
        { success: false, error: 'lineId or receivingId is required' },
        { status: 400 },
      );
    }

    const ticket = await getPrimarySupportTicketForReceiving({
      orgId: ctx.organizationId,
      lineId,
      receivingId,
    });

    if (!ticket) {
      return NextResponse.json({ success: true, ticket: null });
    }

    const providerTicketId =
      ticket.provider === 'zendesk' && ticket.externalTicketId
        ? Number(ticket.externalTicketId)
        : null;

    return NextResponse.json({
      success: true,
      ticket: {
        id: ticket.id,
        label: formatSupportTicketDisplayLabel(ticket),
        provider: ticket.provider,
        externalTicketId: ticket.externalTicketId,
        providerTicketId:
          providerTicketId != null && Number.isFinite(providerTicketId) ? providerTicketId : null,
        openUrl:
          providerTicketId != null && Number.isFinite(providerTicketId)
            ? zendeskTicketUrl(providerTicketId)
            : null,
        subject: ticket.subjectCache,
        status: ticket.statusCache,
      },
    });
  } catch (err) {
    return errorResponse(err, context);
  }
}, { permission: 'receiving.view' });
