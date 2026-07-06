import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import {
  deleteTicket,
  getTicket,
  isZendeskConfiguredForOrg,
  updateTicket,
  ZendeskApiError,
  ZendeskNotConfiguredError,
} from '@/lib/zendesk';

export const dynamic = 'force-dynamic';

/**
 * Single Zendesk ticket.
 *
 *   GET    /api/zendesk/tickets/:id  → fetch one
 *   PATCH  /api/zendesk/tickets/:id  → update fields / add a comment
 *   DELETE /api/zendesk/tickets/:id  → delete (soft-delete in Zendesk)
 *
 * withAuth ignores the route `params`, so the id is parsed from the path.
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

/** Pull the trailing numeric ticket id from /api/zendesk/tickets/:id. */
function ticketIdFromUrl(req: NextRequest): number {
  const segs = req.nextUrl.pathname.split('/').filter(Boolean);
  const raw = decodeURIComponent(segs[segs.length - 1] || '').trim();
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw ApiError.badRequest('A valid numeric ticket id is required');
  }
  return id;
}

export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    const context = 'GET /api/zendesk/tickets/[id]';
    try {
      if (!(await isZendeskConfiguredForOrg(ctx.organizationId))) return notConfigured(context);
      const id = ticketIdFromUrl(req);
      const ticket = await getTicket(id, ctx.organizationId);
      if (!ticket) throw ApiError.notFound('Zendesk ticket', id);
      return NextResponse.json({ success: true, ticket });
    } catch (err) {
      return mapZendeskError(err, context);
    }
  },
  { permission: 'integrations.zendesk' },
);

const UpdateBody = z
  .object({
    subject: z.string().trim().min(1).optional(),
    comment: z
      .object({
        body: z.string().trim().min(1),
        html_body: z.string().optional(),
        public: z.boolean().optional(),
      })
      .optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    status: z.enum(['new', 'open', 'pending', 'hold', 'solved', 'closed']).optional(),
    type: z.enum(['problem', 'incident', 'question', 'task']).optional(),
    tags: z.array(z.string()).optional(),
    assignee_id: z.number().int().positive().nullable().optional(),
    group_id: z.number().int().positive().nullable().optional(),
    external_id: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const PATCH = withAuth(
  async (req: NextRequest, ctx) => {
    const context = 'PATCH /api/zendesk/tickets/[id]';
    try {
      if (!(await isZendeskConfiguredForOrg(ctx.organizationId))) return notConfigured(context);
      const id = ticketIdFromUrl(req);
      const json = await req.json().catch(() => null);
      if (!json) throw ApiError.badRequest('Missing JSON body');
      const input = UpdateBody.parse(json);

      const ticket = await updateTicket(id, input, ctx.organizationId);
      if (!ticket) throw ApiError.notFound('Zendesk ticket', id);
      return NextResponse.json({ success: true, ticket });
    } catch (err) {
      return mapZendeskError(err, context);
    }
  },
  {
    permission: 'integrations.zendesk',
    audit: {
      source: 'api',
      action: 'zendesk.ticket.update',
      entityType: 'zendesk_ticket',
      entityId: ({ response }) =>
        (response as { ticket?: { id?: number } } | null)?.ticket?.id ?? null,
    },
  },
);

export const DELETE = withAuth(
  async (req: NextRequest, ctx) => {
    const context = 'DELETE /api/zendesk/tickets/[id]';
    try {
      if (!(await isZendeskConfiguredForOrg(ctx.organizationId))) return notConfigured(context);
      const id = ticketIdFromUrl(req);
      const ok = await deleteTicket(id, ctx.organizationId);
      if (!ok) throw ApiError.notFound('Zendesk ticket', id);
      return NextResponse.json({ success: true, id });
    } catch (err) {
      return mapZendeskError(err, context);
    }
  },
  {
    permission: 'integrations.zendesk',
    audit: {
      source: 'api',
      action: 'zendesk.ticket.delete',
      entityType: 'zendesk_ticket',
      entityId: ({ req }) => {
        const segs = req.nextUrl.pathname.split('/').filter(Boolean);
        return segs[segs.length - 1] ?? null;
      },
    },
  },
);
