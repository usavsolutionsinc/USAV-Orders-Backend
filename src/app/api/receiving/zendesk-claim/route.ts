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
import {
  readPhotoBytes,
  archiveClaimToFolder,
  archiveClaimViaAgent,
  poReceivingLink,
  resolveClaimArchivePhotoUrl,
} from '@/lib/receiving-claim-photos';
import { readPhotoBytesById } from '@/lib/photos/read-bytes';
import {
  getReceivingPhotosByIds,
  listAllReceivingPhotoIds,
} from '@/lib/photos/queries/receiving-list';
import { createSharePack } from '@/lib/photos/share-packs';
import { linkPhoto } from '@/lib/photos/service';
import { buildExternalId, linkTicket, linkTicketToShipment } from '@/lib/zendesk-links';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';
import { readIdempotencyKey, withIdempotentResponse } from '@/lib/api-idempotency';
import { getOrganization } from '@/lib/tenancy/organizations';
import { getNasStorageTarget } from '@/lib/tenancy/settings';
import { upsertClaimSellerMessage } from '@/lib/receiving-claim-seller-message';
import { claimTicketLinkEntity } from '@/lib/support/tickets';
import pool from '@/lib/db';
import { tenantQuery } from '@/lib/tenancy/db';

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
  /**
   * CC collaborator emails. Zendesk only emails CCs on a PUBLIC comment, so
   * these are applied only when `notePublic` is true (matches the UI, which
   * hides the CC field on an internal note).
   */
  ccEmails?: string[];
  /**
   * File the opening comment as a PUBLIC reply (emails the requester + CCs)
   * instead of the default internal note (`public: false`).
   */
  notePublic?: boolean;
  /**
   * Operator "Test create": assemble the ticket exactly as it would be filed,
   * but create nothing — no Zendesk ticket, no NAS archive, no DB writes.
   */
  dryRun?: boolean;
}

/** Loose email shape — Zendesk validates for real; this just drops obvious junk. */
const CLAIM_CC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    // Recipients: default is an internal note. When the operator opts into a
    // public reply, the opening comment is public and any CC'd emails are added
    // as collaborators (Zendesk only emails CCs on a public comment).
    const notePublic = body.notePublic === true;
    const ccEmails = notePublic && Array.isArray(body.ccEmails)
      ? Array.from(
          new Set(
            body.ccEmails
              .map((e) => String(e).trim())
              .filter((e) => CLAIM_CC_EMAIL_RE.test(e)),
          ),
        )
      : [];

    // Always build the template — even when the operator edited the subject/body
    // — so we have the PO#/tracking to name the photo attachments after the PO.
    const template = await buildReceivingClaimTemplate({
      receivingId,
      lineId,
      claimType,
      reason: body.reason,
      poReceivingLink: poReceivingLink(req, receivingId),
    }, ctx.organizationId);
    const subject = editedSubject || template.subject;
    const description = editedDescription || template.description;

    // Label every uploaded image with the PO# (falls back to tracking, then the
    // receiving id) so the attachments in Zendesk read e.g. "PO-06-14788_001.jpg".
    const fileLabel = (
      template.poNumber
        ? `PO-${template.poNumber}`
        : template.tracking
          ? `TRK-${template.tracking}`
          : `RCV-${receivingId}`
    ).replace(/[^A-Za-z0-9._-]+/g, '-');

    const { entityType, entityId } = claimTicketLinkEntity(lineId, receivingId);

    // Dry-run ("Test create"): we've assembled the exact subject/body that would
    // be filed; now short-circuit before any side-effect — no Zendesk ticket, no
    // NAS archive, no DB writes, no share pack. Lets staff rehearse the flow.
    if (body.dryRun === true) {
      const attachCount = Array.isArray(body.attachPhotoIds)
        ? body.attachPhotoIds.map(Number).filter((n) => Number.isFinite(n) && n > 0).length
        : 0;
      return NextResponse.json({
        success: true,
        dryRun: true,
        ticketNumber: '#TEST',
        subject,
        description,
        attachCount,
        notePublic,
        ccCount: ccEmails.length,
      });
    }

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
          let seq = 0;
          for (const row of photoRows) {
            let pb = await readPhotoBytesById(row.id, ctx.organizationId);
            if (!pb) pb = await readPhotoBytes(String(row.url || ''));
            if (!pb) continue;
            seq += 1;
            const ext = (
              /\.([A-Za-z0-9]+)$/.exec(pb.filename)?.[1] ||
              pb.contentType.split('/')[1] ||
              'jpg'
            ).toLowerCase();
            const fileName = `${fileLabel}_${String(seq).padStart(3, '0')}.${ext}`;
            try {
              uploads.push(await uploadFileToZendesk(fileName, pb.bytes, pb.contentType, ctx.organizationId));
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
                public: notePublic,
                uploads: uploads.length ? uploads : undefined,
              },
              type: 'task',
              tags: ['receiving_claim', `claim_${claimType}`],
              external_id: buildExternalId(entityType, entityId),
              ...(ccEmails.length
                ? { email_ccs: ccEmails.map((user_email) => ({ user_email, action: 'put' as const })) }
                : {}),
            },
            { idempotencyKey: idempotencyKey ?? undefined },
            ctx.organizationId,
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
        let archiveResult: { folder: string; copied: number; total: number } | null = null;
        try {
          const allPhotoIds = await listAllReceivingPhotoIds(ctx.organizationId, receivingId);
          const allPhotos = (
            await Promise.all(
              allPhotoIds.map(async (photoId) => ({
                photoId,
                url: await resolveClaimArchivePhotoUrl(photoId, ctx.organizationId),
              })),
            )
          )
            .filter((p): p is { photoId: number; url: string } => Boolean(p.url))
            .map((p) => ({ url: p.url }));
          const info = [
            `Zendesk Ticket: ${ticketNumber}`,
            `URL: ${zendeskTicketUrl(ticket.id)}`,
            `Subject: ${subject}`,
            `Claim type: ${CLAIM_TYPE_LABEL[claimType]}`,
            `Filed: ${new Date().toISOString()}`,
            `Photos uploaded to Zendesk: ${uploads.length}`,
            `Photos on claim record: ${allPhotoIds.length}`,
            `Photos resolved for NAS archive: ${allPhotos.length}`,
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
                organizationId: ctx.organizationId,
                archiveRoot: claimTarget.root,
                archiveFolder: claimTarget.folder,
              })
            : await archiveClaimToFolder({ ticketId: ticket.id, photos: allPhotos, info });
          if (!archived) {
            archiveWarning = 'Photos were NOT archived to the NAS (archive agent/mount unavailable).';
            console.warn('[zendesk-claim] archive skipped — no agent/mount configured');
          } else {
            archiveResult = archived;
            console.warn(`[zendesk-claim] archived ${archived.copied}/${archived.total} photo(s) → ${archived.folder}`);
            if (allPhotos.length < allPhotoIds.length) {
              archiveWarning = `Only ${archived.copied} of ${allPhotoIds.length} photos archived to the NAS. ${allPhotoIds.length - allPhotos.length} photo source(s) could not be resolved for archiving.`;
            } else if (archived.copied < archived.total) {
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
          const shipmentRow = await tenantQuery<{ shipment_id: number | null }>(
            ctx.organizationId,
            `SELECT shipment_id FROM receiving
              WHERE id = $1 AND organization_id = $2 LIMIT 1`,
            [receivingId, ctx.organizationId],
          );
          const shipmentId = shipmentRow.rows[0]?.shipment_id;
          if (shipmentId != null) {
            await linkTicketToShipment({
              orgId: ctx.organizationId,
              zendeskTicketId: ticket.id,
              shipmentId: Number(shipmentId),
              staffId: ctx.staffId,
            });
          }
        } catch (linkErr) {
          console.warn('[POST /api/receiving/zendesk-claim] ticket link backfill failed', linkErr);
        }

        // Persist the human-visible ticket # onto the record so it shows back on
        // the line (or carton for package-level claims). Best-effort.
        try {
          if (lineId != null) {
            await tenantQuery(ctx.organizationId, `UPDATE receiving_lines SET zendesk_ticket = $1 WHERE id = $2 AND organization_id = $3`, [ticketNumber, lineId, ctx.organizationId]);
          } else {
            await tenantQuery(ctx.organizationId, `UPDATE receiving SET zendesk_ticket = $1 WHERE id = $2 AND organization_id = $3`, [ticketNumber, receivingId, ctx.organizationId]);
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
              }, {}, ctx.organizationId);
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
            // Archive result so the client can DISPLAY the NAS backup status on
            // the seller step (and offer a retry when it failed/was partial).
            archiveOk: !!archiveResult && !archiveWarning,
            archiveCopied: archiveResult?.copied ?? 0,
            archiveTotal: archiveResult?.total ?? 0,
            archiveFolder: archiveResult?.folder ?? null,
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
