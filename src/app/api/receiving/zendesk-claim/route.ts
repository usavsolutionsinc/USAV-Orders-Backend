import { NextRequest, NextResponse } from 'next/server';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import {
  buildReceivingClaimTemplate,
  claimBodyToHtml,
  CLAIM_SEVERITY_LABEL,
  CLAIM_TYPE_LABEL,
  type ClaimSeverity,
  type ClaimType,
} from '@/lib/zendesk-claim-template';
import { createTicket, uploadFileToZendesk, ZendeskNotConfiguredError } from '@/lib/zendesk';
import { readPhotoBytes, archiveClaimToFolder, archiveClaimViaAgent, poReceivingLink } from '@/lib/receiving-claim-photos';
import { buildExternalId, linkTicket } from '@/lib/zendesk-links';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';
import { readIdempotencyKey, withIdempotentResponse } from '@/lib/api-idempotency';
import pool from '@/lib/db';

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
  /** Photo row ids (from /api/receiving-photos) to upload to Zendesk as files. */
  attachPhotoIds?: number[];
}

/**
 * Create a Zendesk ticket for a receiving claim (damage / missing / wrong
 * item / vendor defect) directly via the Zendesk REST API
 * (`createTicket` in src/lib/zendesk.ts).
 *
 * If the operator edited the subject/body in the modal, those values are
 * sent verbatim. Otherwise the template builder fills them from PO/tracking/
 * photos/line context.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
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
    const lineIdRaw = body.lineId != null ? Number(body.lineId) : null;
    const lineId = lineIdRaw != null && Number.isFinite(lineIdRaw) ? lineIdRaw : null;

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
        poReceivingLink: poReceivingLink(req, receivingId),
      });
      subject = editedSubject || template.subject;
      description = editedDescription || template.description;
    }

    const entityType = lineId != null ? 'RECEIVING_LINE' : 'RECEIVING';
    const entityId = lineId != null ? lineId : receivingId;

    // Idempotency: a per-submit key (client UUID via Idempotency-Key header)
    // dedupes double-clicks / network retries so we never file two tickets for
    // the same submission. Cached responses are replayed verbatim.
    const idempotencyKey = readIdempotencyKey(req);
    const result = await withIdempotentResponse(
      pool,
      { idempotencyKey, route: 'POST /api/receiving/zendesk-claim', staffId: ctx.staffId },
      async (): Promise<{ status: number; body: Record<string, unknown> }> => {
        // Upload the operator's selected photos to Zendesk as real file
        // attachments (not links). Scoped to this carton's photos for safety;
        // best-effort per file so one unreadable photo never blocks the claim.
        const uploads: string[] = [];
        const ids = Array.isArray(body.attachPhotoIds)
          ? body.attachPhotoIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)
          : [];
        if (ids.length > 0) {
          const photoRows = await pool.query<{ id: number; url: string | null }>(
            `SELECT id, url FROM photos
              WHERE id = ANY($1::int[])
                AND ((entity_type = 'RECEIVING'      AND entity_id = $2)
                  OR (entity_type = 'RECEIVING_LINE' AND entity_id IN
                        (SELECT id FROM receiving_lines WHERE receiving_id = $2)))`,
            [ids, receivingId],
          );
          for (const row of photoRows.rows) {
            const pb = await readPhotoBytes(String(row.url || ''));
            if (!pb) continue;
            try {
              uploads.push(await uploadFileToZendesk(pb.filename, pb.bytes, pb.contentType));
            } catch (upErr) {
              console.warn('[zendesk-claim] photo upload failed', row.id, upErr);
            }
          }
        }

        // Create the ticket directly via the Zendesk REST API. external_id is set
        // at creation so the support workspace can resolve this claim. Selected
        // photos ride along as `comment.uploads` (real attachments).
        let ticket;
        try {
          ticket = await createTicket(
            {
              subject,
              comment: {
                body: description,
                html_body: claimBodyToHtml(description),
                public: false,
                uploads: uploads.length ? uploads : undefined,
              },
              type: 'task',
              tags: ['receiving_claim', `claim_${claimType}`],
              external_id: buildExternalId(entityType, entityId),
            },
            { idempotencyKey: idempotencyKey ?? undefined },
          );
        } catch (err: unknown) {
          if (err instanceof ZendeskNotConfiguredError) {
            return { status: 503, body: { success: false, error: 'Zendesk is not configured', draftBody: description } };
          }
          return {
            status: 502,
            body: { success: false, error: err instanceof Error ? err.message : 'Zendesk request failed', draftBody: description },
          };
        }

        const ticketNumber = `#${ticket.id}`;

        // Archive ALL of the PO's photos into a folder named after the ticket
        // (".../2 Zendesk 2026/<ticket#>/") so we keep the full set even though
        // only the selected subset was uploaded to Zendesk. In prod (Vercel) this
        // goes through the office archive agent over the tunnel; on a LAN/dev box
        // it writes the mount directly. Best-effort — the ticket already exists,
        // so a hiccup never fails the claim — but we DO surface a warning so a
        // claim whose photos silently didn't archive is visible to the operator.
        let archiveWarning: string | null = null;
        try {
          const allPhotosRes = await pool.query<{ url: string | null }>(
            `SELECT url FROM photos
              WHERE ((entity_type = 'RECEIVING'      AND entity_id = $1)
                  OR (entity_type = 'RECEIVING_LINE' AND entity_id IN
                        (SELECT id FROM receiving_lines WHERE receiving_id = $1)))
              ORDER BY created_at ASC`,
            [receivingId],
          );
          const allPhotos = allPhotosRes.rows
            .map((r) => ({ url: String(r.url || '') }))
            .filter((p) => p.url);
          const info = [
            `Zendesk Ticket: ${ticketNumber}`,
            `URL: ${zendeskTicketUrl(ticket.id)}`,
            `Subject: ${subject}`,
            `Claim type: ${CLAIM_TYPE_LABEL[claimType]}`,
            `Severity: ${CLAIM_SEVERITY_LABEL[severity]}`,
            `Filed: ${new Date().toISOString()}`,
            `Photos uploaded to Zendesk: ${uploads.length}`,
            `Photos archived locally: ${allPhotos.length}`,
            '',
            '--- Ticket body ---',
            description,
          ].join('\n');
          // Prefer the office agent (works from Vercel); fall back to a direct
          // filesystem write when running on a box that has the share mounted.
          const useAgent = Boolean(process.env.NAS_AGENT_URL && process.env.NAS_AGENT_TOKEN);
          const archived = useAgent
            ? await archiveClaimViaAgent({ ticketId: ticket.id, photos: allPhotos, info })
            : await archiveClaimToFolder({ ticketId: ticket.id, photos: allPhotos, info });
          if (!archived) {
            archiveWarning = 'Photos were NOT archived to the NAS (archive agent/mount unavailable).';
            console.warn('[zendesk-claim] archive skipped — no agent/mount configured');
          } else {
            console.log(`[zendesk-claim] archived ${archived.copied}/${archived.total} photo(s) → ${archived.folder}`);
            if (archived.copied < archived.total) {
              archiveWarning = `Only ${archived.copied} of ${archived.total} photos archived to the NAS.`;
            }
          }
        } catch (archiveErr) {
          archiveWarning = `NAS archive failed: ${archiveErr instanceof Error ? archiveErr.message : 'unknown error'}`;
          console.warn('[zendesk-claim] photo archive failed', archiveErr);
        }

        // Write the ticket→entity link row (the support workspace prefers ticket_links
        // over external_id). Best-effort: the ticket already exists, so a failure here
        // must not turn a successful claim into an error.
        try {
          await linkTicket({
            orgId: ctx.organizationId,
            zendeskTicketId: ticket.id,
            entityType,
            entityId,
            staffId: ctx.staffId,
          });
        } catch (linkErr) {
          console.warn('[POST /api/receiving/zendesk-claim] ticket link backfill failed', linkErr);
        }

        // Persist the human-visible ticket # onto the record so it shows back on
        // the line (or carton for package-level claims). Best-effort.
        try {
          if (lineId != null) {
            await pool.query(`UPDATE receiving_lines SET zendesk_ticket = $1 WHERE id = $2`, [ticketNumber, lineId]);
          } else {
            await pool.query(`UPDATE receiving SET zendesk_ticket = $1 WHERE id = $2`, [ticketNumber, receivingId]);
          }
        } catch (colErr) {
          console.warn('[POST /api/receiving/zendesk-claim] zendesk_ticket column update failed', colErr);
        }

        return {
          status: 200,
          body: { success: true, ticketNumber, ticketUrl: zendeskTicketUrl(ticket.id), archiveWarning },
        };
      },
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving/zendesk-claim');
  }
}, { permission: 'receiving.mark_received' });
