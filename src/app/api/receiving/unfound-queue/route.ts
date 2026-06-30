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
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';
import { sqlReceivingPhotoCount } from '@/lib/photos/queries/receiving-list';

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
  photo_count: string;
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
  const excludeUnboxIntake = searchParams.get('exclude_unbox_intake') === 'true';

  const conditions: string[] = ['vq.organization_id = $1'];
  const params: unknown[] = [ctx.organizationId];
  let idx = 2;

  if (kind !== 'all') {
    conditions.push(`vq.kind = $${idx++}`);
    params.push(kind);
  } else {
    // 'all' should not surface station_exception — those are now triaged at
    // the affected station, not in the receiving sidebar.
    conditions.push(`vq.kind <> 'station_exception'`);
  }

  if (checked === 'false') {
    conditions.push('vq.checked = FALSE');
  } else if (checked === 'true') {
    conditions.push('vq.checked = TRUE');
  }

  if (q) {
    conditions.push(
      `(vq.product_title ILIKE $${idx} OR vq.serial_numbers ILIKE $${idx} OR vq.context ILIKE $${idx} OR vq.usa_team_note ILIKE $${idx} OR vq.vietnam_team_note ILIKE $${idx} OR vq.zendesk_ticket_id ILIKE $${idx})`,
    );
    params.push(`%${q}%`);
    idx++;
  }

  // Triage unfound rail only — cartons scanned on the Unbox surface live in the
  // Unboxed rail + History, not the triage Unfound list.
  if (excludeUnboxIntake) {
    conditions.push(`NOT (
      vq.kind = 'unmatched_receiving'
      AND EXISTS (
        SELECT 1 FROM receiving r
        WHERE r.organization_id = vq.organization_id
          AND r.id = vq.source_id::int
          AND (
            r.unbox_opened_at IS NOT NULL
            OR EXISTS (
              SELECT 1 FROM ops_events oe
              WHERE oe.organization_id = r.organization_id
                AND oe.entity_type = 'receiving'
                AND oe.entity_id = r.id
                AND oe.event_type = 'UNBOX_SCAN_OPENED'
            )
          )
      )
    )`);
  }

  params.push(limit, offset);

  const sql = `
    SELECT
      vq.kind, vq.source_id, vq.organization_id,
      vq.product_title, vq.serial_numbers, vq.context,
      vq.created_at::text AS created_at,
      vq.zendesk_ticket_id, vq.zendesk_synced_at::text AS zendesk_synced_at,
      vq.usa_team_note, vq.vietnam_team_note,
      vq.follow_up_at::text AS follow_up_at,
      vq.checked, vq.checked_at::text AS checked_at,
      CASE
        WHEN vq.kind = 'unmatched_receiving' AND vq.source_id ~ '^[0-9]+$'
        THEN ${sqlReceivingPhotoCount('vq.source_id::int', '$1')}
        ELSE 0
      END AS photo_count
    FROM v_unfound_queue vq
    WHERE ${conditions.join(' AND ')}
    ORDER BY vq.checked ASC, vq.created_at DESC
    LIMIT $${idx++} OFFSET $${idx++}
  `;

  const result = await tenantQuery<QueueRow>(ctx.organizationId, sql, params);

  return NextResponse.json({
    success: true,
    rows: result.rows,
    total: result.rows.length,
    limit,
    offset,
    filters: { kind, checked, q },
  });
}, { permission: 'receiving.view' });
