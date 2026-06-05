/**
 * POST /api/receiving/unfound-queue/[kind]/[id]/push-to-zendesk
 *
 * Composes a Zendesk ticket from the queue row + source context and writes
 * the ticket id back onto unfound_overlay (zendesk_ticket_id + zendesk_synced_at).
 *
 * Creates the ticket directly via the Zendesk REST API (`createTicket` in
 * src/lib/zendesk.ts), the same client used by /api/receiving/zendesk-claim.
 *
 * Body (optional overrides):
 *   subject?: string       — operator-edited subject; falls back to a generated one
 *   description?: string   — operator-edited body; falls back to generated
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { after } from 'next/server';
import { createTicket, ZendeskNotConfiguredError } from '@/lib/zendesk';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';
import {
  ALLOWED_UNFOUND_KINDS,
  buildUnfoundTicket,
  loadUnfoundQueueRow,
  unfoundParamsFromUrl,
} from '@/lib/unfound-ticket';

interface PushBody {
  subject?: string;
  description?: string;
}

export const POST = withAuth(async (request: NextRequest, ctx) => {
  const parsed = unfoundParamsFromUrl(request.nextUrl);
  if (!parsed) {
    return NextResponse.json({ success: false, error: 'invalid path' }, { status: 400 });
  }
  const { kind, sourceId } = parsed;
  if (!ALLOWED_UNFOUND_KINDS.has(kind)) {
    return NextResponse.json({ success: false, error: `invalid kind: ${kind}` }, { status: 400 });
  }

  let body: PushBody = {};
  try {
    body = ((await request.json().catch(() => ({}))) as PushBody) ?? {};
  } catch {
    /* tolerate empty body */
  }

  // Load the queue row through v_unfound_queue so we get the same composed
  // shape the UI displays — including notes the operator may have written
  // before clicking Push.
  const row = await loadUnfoundQueueRow(ctx.organizationId, kind, sourceId);
  if (!row) {
    return NextResponse.json(
      { success: false, error: 'queue row not found' },
      { status: 404 },
    );
  }

  if (row.zendesk_ticket_id) {
    return NextResponse.json({
      success: true,
      already_synced: true,
      ticketNumber: row.zendesk_ticket_id,
      ticketUrl: zendeskTicketUrl(row.zendesk_ticket_id),
    });
  }

  const generated = buildUnfoundTicket(row);
  const subject = (body.subject?.trim() || generated.subject).slice(0, 250);
  const description = body.description?.trim() || generated.description;

  // Create the ticket directly via the Zendesk REST API.
  let ticket;
  try {
    ticket = await createTicket(
      {
        subject,
        comment: { body: description, public: false },
        type: 'task',
        tags: ['unfound_queue', `unfound_${kind}`],
      },
      // Entity-derived key: the overlay zendesk_ticket_id check above already
      // blocks a second push, so a stable per-row key is safe defense-in-depth.
      { idempotencyKey: `unfound:${kind}:${sourceId}` },
    );
  } catch (err: unknown) {
    if (err instanceof ZendeskNotConfiguredError) {
      // Surface the would-be ticket body so the operator can copy/paste while
      // Zendesk credentials are being configured.
      return NextResponse.json(
        {
          success: false,
          error: 'Zendesk is not configured',
          draftSubject: subject,
          draftBody: description,
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Zendesk request failed',
        draftSubject: subject,
        draftBody: description,
      },
      { status: 502 },
    );
  }

  const ticketNumber = `#${ticket.id}`;

  // Persist the ticket id onto the overlay (upsert — overlay row may not exist yet).
  await pool.query(
    `INSERT INTO unfound_overlay
       (organization_id, source_kind, source_id, zendesk_ticket_id, zendesk_synced_at, updated_by)
     VALUES ($1, $2, $3, $4, NOW(), $5)
     ON CONFLICT (organization_id, source_kind, source_id) DO UPDATE
       SET zendesk_ticket_id = EXCLUDED.zendesk_ticket_id,
           zendesk_synced_at = EXCLUDED.zendesk_synced_at,
           updated_by        = EXCLUDED.updated_by`,
    [ctx.organizationId, kind, sourceId, ticketNumber, ctx.staffId],
  );

  after(async () => {
    try {
      await invalidateCacheTags(['unfound-queue']);
    } catch (err) {
      console.warn('push-to-zendesk: cache invalidation failed', err);
    }
  });

  return NextResponse.json({ success: true, ticketNumber, ticketUrl: zendeskTicketUrl(ticket.id) });
}, { permission: 'receiving.view' });
