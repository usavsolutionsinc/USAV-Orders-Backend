import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import {
  archiveClaimToFolder,
  archiveClaimViaAgent,
  resolveClaimArchivePhotoUrl,
} from '@/lib/receiving-claim-photos';
import { CLAIM_TYPE_LABEL, type ClaimType } from '@/lib/zendesk-claim-template';
import { listAllReceivingPhotoIds } from '@/lib/photos/queries/receiving-list';
import { getOrganization } from '@/lib/tenancy/organizations';
import { getNasStorageTarget } from '@/lib/tenancy/settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  receivingId: z.number().int().positive(),
  lineId: z.number().int().positive().nullable().optional(),
  ticketNumber: z.string().trim().min(1).max(120),
  claimType: z.enum(['damage', 'missing', 'wrong_item', 'vendor_defect', 'return', 'unfound']).optional(),
  reason: z.string().trim().max(4000).optional(),
  subject: z.string().trim().max(500).optional(),
  description: z.string().trim().max(20000).optional(),
});

function normalizeArchiveFolderName(input: string): string {
  return input.trim().replace(/^#/, '').replace(/[\\/:*?"<>|]+/g, '-').trim();
}

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = Body.parse(await req.json().catch(() => null));
    const folderName = normalizeArchiveFolderName(body.ticketNumber);
    if (!folderName) {
      return NextResponse.json({ success: false, error: 'Folder name is required' }, { status: 400 });
    }

    const allPhotoIds = await listAllReceivingPhotoIds(ctx.organizationId, body.receivingId);
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
      `Archive target: ${folderName}`,
      'Mode: Archive to NAS (no Zendesk ticket created by this call)',
      body.claimType ? `Claim type: ${CLAIM_TYPE_LABEL[body.claimType as ClaimType]}` : null,
      `Receiving id: ${body.receivingId}`,
      body.lineId != null ? `Receiving line id: ${body.lineId}` : null,
      `Captured: ${new Date().toISOString()}`,
      `Photos on claim record: ${allPhotoIds.length}`,
      `Photos resolved for NAS archive: ${allPhotos.length}`,
      body.subject ? `Subject: ${body.subject}` : null,
      body.reason ? `Reason: ${body.reason}` : null,
      '',
      '--- Draft body ---',
      body.description || '',
    ]
      .filter(Boolean)
      .join('\n');

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
          ticketId: folderName,
          photos: allPhotos,
          info,
          organizationId: ctx.organizationId,
          archiveRoot: claimTarget.root,
          archiveFolder: claimTarget.folder,
        })
      : await archiveClaimToFolder({
          ticketId: folderName,
          photos: allPhotos,
          info,
        });

    if (!archived) {
      return NextResponse.json(
        {
          success: false,
          error: 'Photos were NOT archived to the NAS (archive agent/mount unavailable).',
        },
        { status: 503 },
      );
    }

    const archiveWarning =
      allPhotos.length < allPhotoIds.length
        ? `Only ${archived.copied} of ${allPhotoIds.length} photos archived to the NAS. ${allPhotoIds.length - allPhotos.length} photo source(s) could not be resolved for archiving.`
        : archived.copied < archived.total
          ? `Only ${archived.copied} of ${archived.total} photos archived to the NAS.`
          : null;

    return NextResponse.json({
      success: true,
      folder: archived.folder,
      folderName,
      copied: archived.copied,
      total: archived.total,
      archiveWarning,
    });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving/zendesk-claim/archive-only');
  }
}, { permission: 'receiving.mark_received' });
