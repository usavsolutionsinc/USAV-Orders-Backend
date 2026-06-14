/**
 * /api/staff-messages — staff-to-staff messages (the header clipboard
 * "send to staff" flow).
 *
 * No special permission — like /api/staff-todos, every authenticated staffer
 * can send a coworker a note and read their OWN inbox. recipientId is the only
 * cross-user input and is validated to be a live staffer in the SENDER's org;
 * the reader's identity always comes from the verified session, never the body.
 *
 *   GET    ?unread=1&limit=30   → { items: StaffMessageRow[] }   (your inbox)
 *   POST   { recipientId, body, kind?, context?, idempotencyKey? } → { item }
 *   PATCH  { action: 'mark_read', id }   → { success }
 *   PATCH  { action: 'mark_all_read' }   → { success, count }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import {
  StaffMessageCreateBody,
  StaffMessagePatchBody,
} from '@/lib/schemas/staff-messages';
import {
  createStaffMessage,
  listInboxMessages,
  markAllStaffMessagesRead,
  markStaffMessageRead,
  resolveRecipient,
} from '@/lib/neon/staff-messages-queries';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { publishStaffMessage } from '@/lib/realtime/publish';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

export const runtime = 'nodejs';

const ROUTE_STAFF_MESSAGE_POST = 'staff-messages.post';
const AUDIT_SOURCE = 'staff-messages-api';

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const unreadOnly = req.nextUrl.searchParams.get('unread') === '1';
  const limitRaw = Number(req.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : undefined;
  const items = await listInboxMessages(ctx.staffId, { unreadOnly, limit });
  return NextResponse.json({ items });
});

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const raw = await req.json().catch(() => ({}));
  const parsed = parseBody(StaffMessageCreateBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  const recipient = await resolveRecipient(ctx.organizationId, parsed.recipientId);
  if (!recipient) {
    return NextResponse.json({ error: 'RECIPIENT_NOT_FOUND' }, { status: 404 });
  }

  const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
  if (idemKey) {
    const hit = await getApiIdempotencyResponse(pool, idemKey, ROUTE_STAFF_MESSAGE_POST);
    if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
  }

  const item = await createStaffMessage({
    organizationId: ctx.organizationId,
    senderId: ctx.staffId,
    recipientId: recipient.id,
    body: parsed.body,
    kind: parsed.kind,
    context: parsed.context ?? null,
  });

  // Live nudge to the recipient's inbox bell wherever they're signed in.
  await publishStaffMessage({
    organizationId: ctx.organizationId,
    recipientId: item.recipientId,
    messageId: item.id,
    senderId: item.senderId,
    senderName: item.senderName,
    body: item.body,
    kind: item.kind,
    context: item.context,
  });

  await recordAudit(pool, ctx, req, {
    source: AUDIT_SOURCE,
    action: AUDIT_ACTION.STAFF_MESSAGE_SEND,
    entityType: AUDIT_ENTITY.STAFF_MESSAGE,
    entityId: item.id,
    before: null,
    after: { recipientId: item.recipientId, kind: item.kind },
  });

  const responseBody = { success: true, item };
  if (idemKey) {
    await saveApiIdempotencyResponse(pool, {
      idempotencyKey: idemKey,
      route: ROUTE_STAFF_MESSAGE_POST,
      staffId: ctx.staffId,
      statusCode: 201,
      responseBody,
    });
  }
  return NextResponse.json(responseBody, { status: 201 });
});

export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const raw = await req.json().catch(() => ({}));
  const parsed = parseBody(StaffMessagePatchBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  if (parsed.action === 'mark_read') {
    await markStaffMessageRead(ctx.staffId, parsed.id);
    // Idempotent + reconstructable — no audit row for a read receipt.
    return NextResponse.json({ success: true });
  }

  const count = await markAllStaffMessagesRead(ctx.staffId);
  return NextResponse.json({ success: true, count });
});
