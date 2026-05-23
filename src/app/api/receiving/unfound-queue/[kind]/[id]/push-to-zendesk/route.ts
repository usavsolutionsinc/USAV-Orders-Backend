/**
 * POST /api/receiving/unfound-queue/[kind]/[id]/push-to-zendesk
 *
 * Composes a Zendesk ticket from the queue row + source context and writes
 * the ticket id back onto unfound_overlay (zendesk_ticket_id + zendesk_synced_at).
 *
 * Uses the same GAS bridge as /api/receiving/zendesk-claim
 * (process.env.ZendeskTicketMailer_GAS_WebappURL). The bridge handles the
 * actual Zendesk API auth + ticket create.
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

const ALLOWED_KINDS = new Set(['email_po', 'unmatched_receiving', 'station_exception']);

interface PushBody {
  subject?: string;
  description?: string;
}

interface QueueRow {
  kind: string;
  source_id: string;
  product_title: string | null;
  serial_numbers: string | null;
  context: string | null;
  usa_team_note: string | null;
  vietnam_team_note: string | null;
  zendesk_ticket_id: string | null;
}

function paramsFromUrl(url: URL): { kind: string; sourceId: string } | null {
  const segs = url.pathname.split('/');
  const idx = segs.indexOf('unfound-queue');
  if (idx < 0 || idx + 2 >= segs.length) return null;
  return {
    kind: decodeURIComponent(segs[idx + 1]!),
    sourceId: decodeURIComponent(segs[idx + 2]!),
  };
}

function buildDefaultTicket(row: QueueRow): { subject: string; description: string } {
  const kindLabel =
    row.kind === 'email_po'
      ? 'PO Mailbox'
      : row.kind === 'unmatched_receiving'
      ? 'Unmatched Tracking'
      : 'Station Exception';

  const subjectIdentifier =
    row.product_title ?? row.context ?? row.source_id ?? '(no identifier)';
  const subject = `[${kindLabel}] ${subjectIdentifier}`.slice(0, 200);

  const lines: string[] = [];
  lines.push(`Source kind: ${row.kind}`);
  lines.push(`Source id: ${row.source_id}`);
  if (row.context) lines.push(`Context: ${row.context}`);
  if (row.product_title) lines.push(`Product: ${row.product_title}`);
  if (row.serial_numbers) lines.push(`Serials: ${row.serial_numbers}`);
  if (row.usa_team_note) lines.push('', 'USA Team Note:', row.usa_team_note);
  if (row.vietnam_team_note) lines.push('', 'Vietnam Team Note:', row.vietnam_team_note);

  return { subject, description: lines.join('\n') };
}

export const POST = withAuth(async (request: NextRequest, ctx) => {
  const parsed = paramsFromUrl(request.nextUrl);
  if (!parsed) {
    return NextResponse.json({ success: false, error: 'invalid path' }, { status: 400 });
  }
  const { kind, sourceId } = parsed;
  if (!ALLOWED_KINDS.has(kind)) {
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
  const rowRes = await pool.query<QueueRow>(
    `SELECT kind, source_id, product_title, serial_numbers, context,
            usa_team_note, vietnam_team_note, zendesk_ticket_id
       FROM v_unfound_queue
      WHERE organization_id = $1 AND kind = $2 AND source_id = $3
      LIMIT 1`,
    [ctx.organizationId, kind, sourceId],
  );
  const row = rowRes.rows[0];
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
    });
  }

  const generated = buildDefaultTicket(row);
  const subject = (body.subject?.trim() || generated.subject).slice(0, 250);
  const description = body.description?.trim() || generated.description;

  const gasUrl = process.env.ZendeskTicketMailer_GAS_WebappURL;
  if (!gasUrl) {
    // Surface the would-be ticket body so the operator can copy/paste while
    // the bridge is being configured.
    return NextResponse.json(
      {
        success: false,
        error: 'Zendesk bridge not configured (ZendeskTicketMailer_GAS_WebappURL)',
        draftSubject: subject,
        draftBody: description,
      },
      { status: 503 },
    );
  }

  let ticketNumber: string | null = null;
  try {
    const gasRes = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject,
        description,
        customerName: 'USAV Receiving — Unfound Queue',
        customerEmail: '',
      }),
    });
    if (!gasRes.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `Zendesk bridge HTTP ${gasRes.status}`,
          draftSubject: subject,
          draftBody: description,
        },
        { status: 502 },
      );
    }
    const result = (await gasRes.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!result?.ok) {
      return NextResponse.json(
        {
          success: false,
          error: (result?.error as string) || 'Bridge rejected request',
          draftSubject: subject,
          draftBody: description,
        },
        { status: 502 },
      );
    }
    const rawId =
      (result.ticketNumber as string | number | undefined) ??
      (result.ticket_number as string | number | undefined) ??
      (result.ticketId as string | number | undefined) ??
      (result.ticket_id as string | number | undefined) ??
      (result.id as string | number | undefined);
    if (rawId != null) {
      const s = String(rawId);
      ticketNumber = s.startsWith('#') ? s : `#${s}`;
    }
  } catch (err: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Bridge request failed',
        draftSubject: subject,
        draftBody: description,
      },
      { status: 502 },
    );
  }

  if (!ticketNumber) {
    return NextResponse.json(
      {
        success: false,
        error: 'Bridge returned no ticket id',
        draftSubject: subject,
        draftBody: description,
      },
      { status: 502 },
    );
  }

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

  return NextResponse.json({ success: true, ticketNumber });
}, { permission: 'receiving.view' });
