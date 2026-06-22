import { NextRequest, NextResponse } from 'next/server';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import {
  buildReceivingClaimTemplate,
  claimBodyToHtml,
  CLAIM_TYPE_LABEL,
  type ClaimType,
} from '@/lib/zendesk-claim-template';
import { createTicket, uploadFileToZendesk, ZendeskNotConfiguredError, addTicketComment } from '@/lib/zendesk';
import { readPhotoBytes, archiveClaimToFolder, archiveClaimViaAgent, poReceivingLink } from '@/lib/receiving-claim-photos';
import { readPhotoBytesById } from '@/lib/photos/read-bytes';
import {
  getReceivingPhotosByIds,
  listAllReceivingPhotoIds,
} from '@/lib/photos/queries/receiving-list';
import { createSharePack } from '@/lib/photos/share-packs';
import { linkPhoto } from '@/lib/photos/service';
import { buildExternalId, linkTicket } from '@/lib/zendesk-links';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';
import { readIdempotencyKey, withIdempotentResponse } from '@/lib/api-idempotency';
import { getOrganization } from '@/lib/tenancy/organizations';
import { getNasStorageTarget } from '@/lib/tenancy/settings';
import { upsertClaimSellerMessage } from '@/lib/receiving-claim-seller-message';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

interface ClaimRequest {
  receivingId: number;
  lineId?: number | null;
  claimType: ClaimType;
  reason?: string;
  /** Operator-edited subject. When omitted, the server builds from template. */
  subject?: string;
  /** Operator-edited body. When omitted, the server builds from template. */
  description?: string;
  /** Seller-facing marketplace message (plain text, no URLs). Persisted to Neon. */
  sellerMessage?: string;
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
      { orgId: ctx.organizationId, idempotencyKey, route: 'POST /api/receiving/zendesk-claim', staffId: ctx.staffId },
      async (): Promise<{ status: number; body: Record<string, unknown> }> => {
        // Upload the operator's selected photos to Zendesk as real file
        // attachments (not links). Scoped to this carton's photos for safety;
        // best-effort per file so one unreadable photo never blocks the claim.
        const uploads: string[] = [];
        const ids = Array.isArray(body.attachPhotoIds)
          ? body.attachPhotoIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)
          : [];
        if (ids.length > 0) {
          const photoRows = await getReceivingPhotosByIds({
            organizationId: ctx.organizationId,
            receivingId,
            photoIds: ids,
          });
          for (const row of photoRows) {
            let pb = await readPhotoBytesById(row.id, ctx.organizationId);
            if (!pb) pb = await readPhotoBytes(String(row.url || ''));
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
          const allPhotosRes = await pool.query<{ legacy_url: string | null }>(
            `SELECT ps.legacy_url
               FROM photos p
               JOIN photo_entity_links l
                 ON l.photo_id = p.id AND l.organization_id = p.organization_id
               JOIN photo_storage ps
                 ON ps.photo_id = p.id AND ps.organization_id = p.organization_id AND ps.is_primary
               LEFT JOIN receiving_lines rl
                      ON l.entity_type = 'RECEIVING_LINE' AND rl.id = l.entity_id
              WHERE p.organization_id = $1
                AND (
                  (l.entity_type = 'RECEIVING' AND l.entity_id = $2)
                  OR (l.entity_type = 'RECEIVING_LINE' AND rl.receiving_id = $2)
                )
              ORDER BY p.created_at ASC`,
            [ctx.organizationId, receivingId],
          );
          const allPhotos = allPhotosRes.rows
            .map((r) => ({ url: String(r.legacy_url || '') }))
            .filter((p) => p.url);
          const info = [
            `Zendesk Ticket: ${ticketNumber}`,
            `URL: ${zendeskTicketUrl(ticket.id)}`,
            `Subject: ${subject}`,
            `Claim type: ${CLAIM_TYPE_LABEL[claimType]}`,
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
          let claimTarget = { root: '', folder: '' };
          if (useAgent) {
            try {
              const org = await getOrganization(ctx.organizationId);
              if (org) claimTarget = getNasStorageTarget(org.settings, 'claims');
            } catch {
              claimTarget = { root: '', folder: '' };
            }
          }
          const archived = useAgent
            ? await archiveClaimViaAgent({
                ticketId: ticket.id,
                photos: allPhotos,
                info,
                archiveRoot: claimTarget.root,
                archiveFolder: claimTarget.folder,
              })
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

        const sellerDraft = typeof body.sellerMessage === 'string' ? body.sellerMessage.trim() : '';
        if (sellerDraft) {
          try {
            await upsertClaimSellerMessage({
              orgId: ctx.organizationId,
              receivingId,
              lineId,
              sellerMessage: sellerDraft,
              subjectSnapshot: subject,
              zendeskTicketId: ticket.id,
              staffId: ctx.staffId ?? null,
            });
          } catch (sellerErr) {
            console.warn('[POST /api/receiving/zendesk-claim] seller message persist failed', sellerErr);
          }
        }

        let sharePackUrl: string | null = null;
        try {
          const sharePhotoIds =
            ids.length > 0
              ? ids
              : await listAllReceivingPhotoIds(ctx.organizationId, receivingId);

          if (sharePhotoIds.length > 0) {
            const pack = await createSharePack(
              {
                organizationId: ctx.organizationId,
                staffId: ctx.staffId,
                photoIds: sharePhotoIds,
                title: `Claim ${ticketNumber}`,
                packType: 'claim',
                receivingId,
                zendeskTicketId: ticket.id,
                filenamePrefix: `Claim_${ticket.id}`,
              },
              req.nextUrl.origin,
            );
            sharePackUrl = pack.shareUrl;
            for (const photoId of sharePhotoIds) {
              await linkPhoto({
                organizationId: ctx.organizationId,
                photoId,
                entityType: 'ZENDESK_TICKET',
                entityId: ticket.id,
                linkRole: 'claim_evidence',
              });
            }
            try {
              await addTicketComment(ticket.id, {
                body: `Photo share pack: ${sharePackUrl}`,
                html_body: `<p>Photo share pack: <a href="${sharePackUrl}">${sharePackUrl}</a></p>`,
                public: false,
              });
            } catch (commentErr) {
              console.warn('[zendesk-claim] share pack comment failed', commentErr);
            }
          }
        } catch (shareErr) {
          console.warn('[zendesk-claim] share pack failed', shareErr);
        }

        return {
          status: 200,
          body: {
            success: true,
            ticketNumber,
            ticketUrl: zendeskTicketUrl(ticket.id),
            archiveWarning,
            sharePackUrl,
          },
        };
      },
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving/zendesk-claim');
  }
}, { permission: 'receiving.mark_received' });
