import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import {
  addTicketComment,
  getUsers,
  isZendeskConfigured,
  listAgents,
  listTicketComments,
  ZendeskApiError,
  ZendeskNotConfiguredError,
  type ZendeskComment,
} from '@/lib/zendesk';
import type { OrgId } from '@/lib/tenancy/constants';
import { getCachedUsers, upsertCachedUsers } from '@/lib/zendesk-users-cache';

export const dynamic = 'force-dynamic';

/**
 * Attach author identity (name/email/photo) to each comment server-side, so the
 * chat thread renders names on first paint instead of flickering "User #<id>".
 * Sources: the in-proc agent roster + the zendesk_users cache table. Author ids
 * missing from both are backfilled in the background (after()) so the next load
 * is resolved — we never block the response on a live user fetch.
 */
async function enrichCommentAuthors(
  organizationId: OrgId,
  comments: ZendeskComment[],
): Promise<ZendeskComment[]> {
  const ids = Array.from(new Set(comments.map((c) => c.author_id).filter((n) => n > 0)));
  if (!ids.length) return comments;

  const [agents, cached] = await Promise.all([
    listAgents().catch(() => []),
    getCachedUsers(organizationId, ids),
  ]);
  const agentsById = new Map(agents.map((a) => [a.id, a]));

  const enriched = comments.map((c) => {
    const agent = agentsById.get(c.author_id);
    const user = cached.get(c.author_id);
    const src = agent ?? user;
    if (!src) return c;
    return {
      ...c,
      author_name: src.name,
      author_email: src.email ?? null,
      author_photo: src.photo ?? null,
      author_is_agent: Boolean(agent),
    } as ZendeskComment;
  });

  // Backfill any ids we couldn't resolve, without blocking the response.
  const missing = ids.filter((id) => !agentsById.has(id) && !cached.has(id));
  if (missing.length) {
    after(async () => {
      try {
        const fetched = await getUsers(missing);
        if (fetched.length) await upsertCachedUsers(organizationId, fetched);
      } catch (err) {
        console.warn('[comments] author backfill failed', err);
      }
    });
  }
  return enriched;
}

/**
 * Zendesk ticket comment thread.
 *
 *   GET  /api/zendesk/tickets/:id/comments  → list comments (replies + notes)
 *   POST /api/zendesk/tickets/:id/comments  → add a comment (public reply or
 *                                             internal note when public:false)
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

/** Parse the ticket id from /api/zendesk/tickets/:id/comments. */
function ticketIdFromUrl(req: NextRequest): number {
  const segs = req.nextUrl.pathname.split('/').filter(Boolean);
  const commentsIdx = segs.lastIndexOf('comments');
  const raw = decodeURIComponent(segs[commentsIdx - 1] || '').trim();
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw ApiError.badRequest('A valid numeric ticket id is required');
  }
  return id;
}

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  perPage: z.coerce.number().int().min(1).max(100).optional(),
});

export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    const context = 'GET /api/zendesk/tickets/[id]/comments';
    try {
      if (!isZendeskConfigured()) return notConfigured(context);
      const id = ticketIdFromUrl(req);
      const sp = req.nextUrl.searchParams;
      const { page, perPage } = ListQuery.parse({
        page: sp.get('page') ?? undefined,
        perPage: sp.get('perPage') ?? sp.get('per_page') ?? undefined,
      });
      const result = await listTicketComments(id, { page, perPage });
      const comments = await enrichCommentAuthors(ctx.organizationId, result.comments);
      return NextResponse.json({ success: true, ...result, comments });
    } catch (err) {
      return mapZendeskError(err, context);
    }
  },
  { permission: 'integrations.zendesk' },
);

const CommentBody = z.object({
  body: z.string().trim().min(1, 'body is required'),
  html_body: z.string().optional(),
  public: z.boolean().optional(),
  /** CC collaborator emails — added to the ticket alongside a public reply. */
  email_ccs: z.array(z.string().trim().email()).max(50).optional(),
});

export const POST = withAuth(
  async (req: NextRequest) => {
    const context = 'POST /api/zendesk/tickets/[id]/comments';
    try {
      if (!isZendeskConfigured()) return notConfigured(context);
      const id = ticketIdFromUrl(req);
      const json = await req.json().catch(() => null);
      if (!json) throw ApiError.badRequest('Missing JSON body');
      const input = CommentBody.parse(json);

      const ticket = await addTicketComment(
        id,
        { body: input.body, html_body: input.html_body, public: input.public },
        { emailCcs: input.email_ccs?.map((user_email) => ({ user_email, action: 'put' as const })) },
      );
      if (!ticket) throw ApiError.notFound('Zendesk ticket', id);
      return NextResponse.json({ success: true, ticket }, { status: 201 });
    } catch (err) {
      return mapZendeskError(err, context);
    }
  },
  {
    permission: 'integrations.zendesk',
    audit: {
      source: 'api',
      action: 'zendesk.ticket.comment',
      entityType: 'zendesk_ticket',
      entityId: ({ response }) =>
        (response as { ticket?: { id?: number } } | null)?.ticket?.id ?? null,
    },
  },
);
