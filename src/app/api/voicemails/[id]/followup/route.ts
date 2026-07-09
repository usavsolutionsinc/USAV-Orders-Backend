import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { updateFollowup } from '@/lib/voice/voicemail-mutations';
import { createStaffMessage, resolveRecipient } from '@/lib/neon/staff-messages-queries';
import { publishStaffMessage, publishVoiceEvent } from '@/lib/realtime/publish';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/voicemails/:id/followup
 *   body: { status?, snoozeUntil?, assignedStaffId?, note? }
 * Updates the in-app follow-up (mark done / snooze / assign / note). Assigning
 * to someone else drops a notification in their inbox bell.
 */

function voicemailIdFromUrl(req: NextRequest): number {
  const segs = req.nextUrl.pathname.split('/').filter(Boolean);
  const i = segs.lastIndexOf('followup');
  const id = Number(decodeURIComponent(segs[i - 1] || ''));
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('A valid numeric voicemail id is required');
  return id;
}

const Body = z
  .object({
    status: z.enum(['open', 'snoozed', 'done', 'no_action']).optional(),
    snoozeUntil: z.string().datetime().nullable().optional(),
    assignedStaffId: z.number().int().positive().nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' });

export const PATCH = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const id = voicemailIdFromUrl(req);
      const json = await req.json().catch(() => null);
      if (!json) throw ApiError.badRequest('Missing JSON body');
      const body = Body.parse(json);

      // Assignee, if provided, must be a live staffer in this org — never trust the body.
      if (body.assignedStaffId != null) {
        const recipient = await resolveRecipient(ctx.organizationId, body.assignedStaffId);
        if (!recipient) throw ApiError.notFound('Staff member', body.assignedStaffId);
      }

      const result = await updateFollowup(ctx.organizationId, id, body, ctx.staffId);
      if (result.notFound) throw ApiError.notFound('Voicemail', id);

      const resolved = body.status === 'done' || body.status === 'no_action';
      await recordAudit(pool, ctx, req, {
        source: 'api',
        action: resolved ? AUDIT_ACTION.VOICEMAIL_FOLLOWUP_RESOLVED : 'voicemail.followup.update',
        entityType: AUDIT_ENTITY.VOICEMAIL,
        entityId: id,
        after: { status: result.status ?? null, assignedStaffId: result.assignedStaffId ?? null },
      });

      // Notify a (non-self) assignee.
      if (body.assignedStaffId != null && body.assignedStaffId !== ctx.staffId) {
        const message = await createStaffMessage({
          organizationId: ctx.organizationId,
          senderId: ctx.staffId,
          recipientId: body.assignedStaffId,
          body: `Assigned a voicemail follow-up to you`,
          kind: 'voicemail_followup',
          context: { voicemailId: id },
        });
        await publishStaffMessage({
          organizationId: ctx.organizationId,
          recipientId: message.recipientId,
          messageId: message.id,
          senderId: message.senderId,
          senderName: message.senderName,
          body: message.body,
          kind: message.kind,
          context: message.context,
        });
      }

      void publishVoiceEvent({
        organizationId: ctx.organizationId,
        kind: 'voicemail',
        change: 'updated',
        voicemailId: id,
      }).catch(() => {});

      return NextResponse.json({ success: true, status: result.status, assignedStaffId: result.assignedStaffId });
    } catch (err) {
      return errorResponse(err, 'PATCH /api/voicemails/[id]/followup');
    }
  },
  { permission: 'integrations.zendesk' },
);
