import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import {
  addTicketComment,
  createTicket,
  isZendeskConfiguredForOrg,
  ZendeskApiError,
  ZendeskNotConfiguredError,
} from '@/lib/zendesk';
import { linkTicket } from '@/lib/zendesk-links';
import {
  linkLibraryPhotosToTicket,
  mergeUploadResults,
  uploadLibraryPhotosToZendesk,
  uploadRawFilesToZendesk,
  type RawAttachment,
} from '@/lib/zendesk-attachments';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';

export const dynamic = 'force-dynamic';

/**
 * POST /api/zendesk/photo-ticket  (multipart/form-data)
 *
 * One chokepoint for "turn a selection of library photos into a Zendesk ticket":
 *   - mode=create → new ticket (subject/description/priority/tags/requester),
 *   - mode=update → reply / internal note on an existing ticket.
 *
 * Form fields:
 *   meta   — JSON string (validated by MetaSchema below)
 *   files  — zero or more ad-hoc files drag-dropped into the modal
 *
 * Selected library photos (meta.photoIds) and dropped files are uploaded to
 * Zendesk's Uploads API and ride along as REAL attachments on the comment.
 * Gated by integrations.zendesk (same as the rest of the Zendesk surface).
 */

const Requester = z
  .object({ name: z.string().trim().optional(), email: z.string().trim().email().optional() })
  .partial();

const MetaSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('create'),
    subject: z.string().trim().min(1, 'Subject is required'),
    description: z.string().trim().min(1, 'Description is required'),
    isPublic: z.boolean().optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    type: z.enum(['problem', 'incident', 'question', 'task']).optional(),
    status: z.enum(['new', 'open', 'pending', 'hold', 'solved', 'closed']).optional(),
    tags: z.array(z.string().trim().min(1)).max(20).optional(),
    requester: Requester.optional(),
    photoIds: z.array(z.number().int().positive()).max(100).optional(),
  }),
  z.object({
    mode: z.literal('update'),
    ticketId: z.number().int().positive(),
    comment: z.string().trim().min(1, 'A reply or note is required'),
    /** Formatted HTML for the customer email (rendered from the comment markdown). */
    htmlBody: z.string().optional(),
    isPublic: z.boolean().optional(),
    /** CC collaborator emails added alongside a public reply. */
    emailCcs: z.array(z.string().trim().email()).max(50).optional(),
    photoIds: z.array(z.number().int().positive()).max(100).optional(),
  }),
]);

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

export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    const context = 'POST /api/zendesk/photo-ticket';
    try {
      if (!(await isZendeskConfiguredForOrg(ctx.organizationId))) return notConfigured(context);

      const form = await req.formData();
      const metaRaw = form.get('meta');
      if (typeof metaRaw !== 'string') throw ApiError.badRequest('Missing meta field');

      let metaJson: unknown;
      try {
        metaJson = JSON.parse(metaRaw);
      } catch {
        throw ApiError.badRequest('meta is not valid JSON');
      }
      const meta = MetaSchema.parse(metaJson);

      // Ad-hoc files dropped into the modal (separate from library photoIds).
      const rawFiles: RawAttachment[] = [];
      for (const entry of form.getAll('files')) {
        if (entry instanceof File && entry.size > 0) {
          rawFiles.push({
            filename: entry.name || 'attachment',
            bytes: new Uint8Array(await entry.arrayBuffer()),
            contentType: entry.type || 'application/octet-stream',
          });
        }
      }

      const photoIds = meta.photoIds ?? [];
      const uploadResult = mergeUploadResults(
        await uploadLibraryPhotosToZendesk(ctx.organizationId, photoIds),
        await uploadRawFilesToZendesk(rawFiles, ctx.organizationId),
      );
      const uploads = uploadResult.tokens.length ? uploadResult.tokens : undefined;

      if (meta.mode === 'create') {
        const requester =
          meta.requester && (meta.requester.name || meta.requester.email) ? meta.requester : undefined;

        const ticket = await createTicket({
          subject: meta.subject,
          comment: { body: meta.description, public: meta.isPublic ?? false, uploads },
          priority: meta.priority,
          type: meta.type,
          status: meta.status,
          tags: meta.tags,
          requester,
        }, {}, ctx.organizationId);

        // Self-link the ticket to its own ZENDESK_TICKET entity + link the photos
        // to it, so the support detail strip and claims scope both resolve them.
        if (photoIds.length) {
          try {
            await linkTicket({
              orgId: ctx.organizationId,
              zendeskTicketId: ticket.id,
              entityType: 'ZENDESK_TICKET',
              entityId: ticket.id,
              staffId: ctx.staffId,
            });
          } catch (err) {
            console.warn('[photo-ticket] linkTicket failed', err);
          }
          await linkLibraryPhotosToTicket(ctx.organizationId, ticket.id, photoIds);
        }

        return NextResponse.json(
          {
            success: true,
            mode: 'create' as const,
            ticket: { id: ticket.id, number: `#${ticket.id}`, url: zendeskTicketUrl(ticket.id) },
            attached: uploadResult.attached,
            failed: uploadResult.failed,
          },
          { status: 201 },
        );
      }

      // mode === 'update' — post the reply / note with the attachments.
      const updated = await addTicketComment(
        meta.ticketId,
        {
          body: meta.comment,
          html_body: meta.htmlBody,
          public: meta.isPublic ?? false,
          uploads,
        },
        {
          // CCs only make sense on a public reply; ignore them on an internal note.
          emailCcs:
            meta.isPublic && meta.emailCcs?.length
              ? meta.emailCcs.map((user_email) => ({ user_email, action: 'put' as const }))
              : undefined,
        },
        ctx.organizationId,
      );
      if (!updated) throw new ApiError(404, 'Ticket not found', `Ticket #${meta.ticketId} no longer exists.`);

      // Don't clobber an existing ticket_links mapping on update; just associate
      // the photos so they appear in the claims scope keyed to this ticket.
      if (photoIds.length) {
        await linkLibraryPhotosToTicket(ctx.organizationId, meta.ticketId, photoIds);
      }

      return NextResponse.json({
        success: true,
        mode: 'update' as const,
        ticket: { id: meta.ticketId, number: `#${meta.ticketId}`, url: zendeskTicketUrl(meta.ticketId) },
        attached: uploadResult.attached,
        failed: uploadResult.failed,
      });
    } catch (err) {
      return mapZendeskError(err, context);
    }
  },
  {
    permission: 'integrations.zendesk',
    audit: {
      source: 'api',
      action: 'zendesk.ticket.photo_attach',
      entityType: 'zendesk_ticket',
      entityId: ({ response }) =>
        (response as { ticket?: { id?: number } } | null)?.ticket?.id ?? null,
    },
  },
);
