/**
 * GET /api/receiving/unfound-queue
 *
 * Reads from v_unfound_queue (Phase 0.2 migration). At baseline the view
 * only contains kind='unmatched_receiving' rows; Phase 2.5/2.6 will UNION
 * in email_po and station_exception branches without API changes here.
 *
 * Query params:
 *   ?kind=all|unmatched_receiving|email_po|station_exception   (default: all)
 *   ?checked=false|true|all                                    (default: false)
 *   ?q=<search>                                                (matches product_title, serial_numbers, context, usa_team_note, vietnam_team_note)
 *   ?limit=<n>                                                 (default 100, max 500)
 *   ?offset=<n>                                                (default 0)
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';

const ALLOWED_KINDS = new Set([
  'all',
  'email_po',
  'unmatched_receiving',
  'station_exception',
]);

interface QueueRow {
  kind: string;
  source_id: string;
  organization_id: string;
  product_title: string | null;
  serial_numbers: string | null;
  context: string | null;
  created_at: string;
  zendesk_ticket_id: string | null;
  zendesk_synced_at: string | null;
  usa_team_note: string | null;
  vietnam_team_note: string | null;
  follow_up_at: string | null;
  checked: boolean;
  checked_at: string | null;
}

export const GET = withAuth(async (request: NextRequest, ctx) => {
  const { searchParams } = new URL(request.url);

  const rawKind = (searchParams.get('kind') || 'all').trim().toLowerCase();
  const kind = ALLOWED_KINDS.has(rawKind) ? rawKind : 'all';

  const rawChecked = (searchParams.get('checked') || 'false').trim().toLowerCase();
  const checked: 'true' | 'false' | 'all' =
    rawChecked === 'true' || rawChecked === 'all' ? (rawChecked as 'true' | 'all') : 'false';

  const q = (searchParams.get('q') || '').trim();
  const limit = Math.min(Math.max(Number(searchParams.get('limit') || 100), 1), 500);
  const offset = Math.max(Number(searchParams.get('offset') || 0), 0);

  const conditions: string[] = ['organization_id = $1'];
  const params: unknown[] = [ctx.organizationId];
  let idx = 2;

  if (kind !== 'all') {
    conditions.push(`kind = $${idx++}`);
    params.push(kind);
  }

  if (checked === 'false') {
    conditions.push('checked = FALSE');
  } else if (checked === 'true') {
    conditions.push('checked = TRUE');
  }

  if (q) {
    conditions.push(
      `(product_title ILIKE $${idx} OR serial_numbers ILIKE $${idx} OR context ILIKE $${idx} OR usa_team_note ILIKE $${idx} OR vietnam_team_note ILIKE $${idx} OR zendesk_ticket_id ILIKE $${idx})`,
    );
    params.push(`%${q}%`);
    idx++;
  }

  params.push(limit, offset);

  const sql = `
    SELECT
      kind, source_id, organization_id,
      product_title, serial_numbers, context,
      created_at::text AS created_at,
      zendesk_ticket_id, zendesk_synced_at::text AS zendesk_synced_at,
      usa_team_note, vietnam_team_note,
      follow_up_at::text AS follow_up_at,
      checked, checked_at::text AS checked_at
    FROM v_unfound_queue
    WHERE ${conditions.join(' AND ')}
    ORDER BY checked ASC, created_at DESC
    LIMIT $${idx++} OFFSET $${idx++}
  `;

  const result = await pool.query<QueueRow>(sql, params);

  return NextResponse.json({
    success: true,
    rows: result.rows,
    total: result.rows.length,
    limit,
    offset,
    filters: { kind, checked, q },
  });
}, { permission: 'receiving.view' });
