import { NextRequest, NextResponse } from 'next/server';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import { isZendeskConfigured, ZendeskApiError, ZendeskNotConfiguredError } from '@/lib/zendesk';
import { getEntityPhotos, getTicketEntity } from '@/lib/zendesk-links';

export const dynamic = 'force-dynamic';

/**
 * GET /api/zendesk/tickets/:id/photos
 *
 * Resolves the ticket's linked internal entity (ticket_links → external_id →
 * unfound_overlay), then returns that entity's Vercel Blob photos. Photos are
 * NOT fetched from Zendesk — our Blob is the source of truth for ticket images.
 *
 * Returns { success, entity, photos } — entity is null when no link is known
 * (e.g. inbound / Zendesk-native tickets), in which case photos is [].
 */

function notConfigured(context: string): NextResponse {
  return errorResponse(
    new ApiError(503, 'Zendesk is not configured', 'Set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL and ZENDESK_API_TOKEN.'),
    context,
  );
}

function mapZendeskError(err: unknown, context: string): NextResponse {
  if (err instanceof ZendeskNotConfiguredError) return notConfigured(context);
  if (err instanceof ZendeskApiError) {
    const status = err.status >= 400 && err.status < 600 ? err.status : 502;
    return errorResponse(new ApiError(status, 'Zendesk API error', err.message), context);
  }
  return errorResponse(err, context);
}

function ticketIdFromUrl(req: NextRequest): number {
  const segs = req.nextUrl.pathname.split('/').filter(Boolean);
  const photosIdx = segs.lastIndexOf('photos');
  const raw = decodeURIComponent(segs[photosIdx - 1] || '').trim();
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw ApiError.badRequest('A valid numeric ticket id is required');
  }
  return id;
}

export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    const context = 'GET /api/zendesk/tickets/[id]/photos';
    try {
      if (!isZendeskConfigured()) return notConfigured(context);
      const id = ticketIdFromUrl(req);

      const entity = await getTicketEntity(ctx.organizationId, id);
      if (!entity) {
        return NextResponse.json({ success: true, entity: null, photos: [] });
      }

      const photos = await getEntityPhotos(entity);
      return NextResponse.json({
        success: true,
        entity: { type: entity.type, id: entity.id, source: entity.source },
        photos,
      });
    } catch (err) {
      return mapZendeskError(err, context);
    }
  },
  { permission: 'integrations.zendesk' },
);
