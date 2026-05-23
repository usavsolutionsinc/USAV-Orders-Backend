/**
 * PATCH /api/receiving/unfound-queue/[kind]/[id]
 *
 * Lazy upsert into unfound_overlay (the polymorphic queue-metadata table).
 * The overlay row only exists once an operator first touches any of these
 * fields — until then the v_unfound_queue view returns NULLs from its
 * LEFT JOIN.
 *
 * Body (all optional, only set keys are written):
 *   zendesk_ticket_id   string | null
 *   usa_team_note       string | null
 *   vietnam_team_note   string | null
 *   follow_up_at        ISO timestamp | null
 *   checked             boolean
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { after } from 'next/server';

const ALLOWED_KINDS = new Set([
  'email_po',
  'unmatched_receiving',
  'station_exception',
]);

interface PatchBody {
  zendesk_ticket_id?: string | null;
  usa_team_note?: string | null;
  vietnam_team_note?: string | null;
  follow_up_at?: string | null;
  checked?: boolean;
}

function paramsFromUrl(url: URL): { kind: string; sourceId: string } | null {
  const segs = url.pathname.split('/');
  const idx = segs.indexOf('unfound-queue');
  if (idx < 0 || idx + 2 >= segs.length) return null;
  return { kind: decodeURIComponent(segs[idx + 1]!), sourceId: decodeURIComponent(segs[idx + 2]!) };
}

export const PATCH = withAuth(async (request: NextRequest, ctx) => {
  const parsed = paramsFromUrl(request.nextUrl);
  if (!parsed) {
    return NextResponse.json({ success: false, error: 'invalid path' }, { status: 400 });
  }
  const { kind, sourceId } = parsed;
  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json(
      { success: false, error: `invalid kind: ${kind}` },
      { status: 400 },
    );
  }
  if (!sourceId) {
    return NextResponse.json({ success: false, error: 'source id required' }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ success: false, error: 'invalid JSON body' }, { status: 400 });
  }

  // Only include columns the client actually sent — otherwise the UPSERT
  // would overwrite stored values with `undefined → NULL`.
  const setKeys: string[] = [];
  const setValues: unknown[] = [];
  const addSet = (col: string, val: unknown) => {
    setKeys.push(col);
    setValues.push(val);
  };

  if ('zendesk_ticket_id' in body) addSet('zendesk_ticket_id', body.zendesk_ticket_id ?? null);
  if ('usa_team_note' in body) addSet('usa_team_note', body.usa_team_note ?? null);
  if ('vietnam_team_note' in body) addSet('vietnam_team_note', body.vietnam_team_note ?? null);
  if ('follow_up_at' in body) addSet('follow_up_at', body.follow_up_at ?? null);
  if ('checked' in body) addSet('checked', !!body.checked);

  if (setKeys.length === 0) {
    return NextResponse.json(
      { success: false, error: 'no editable fields provided' },
      { status: 400 },
    );
  }

  // Build the column list + insert placeholders + ON CONFLICT update clause.
  // Identity columns are organization_id, source_kind, source_id; the
  // remaining columns are the dynamic set + updated_by (always from session).
  const insertCols = ['organization_id', 'source_kind', 'source_id', ...setKeys, 'updated_by'];
  const insertVals: unknown[] = [
    ctx.organizationId,
    kind,
    sourceId,
    ...setValues,
    ctx.staffId,
  ];
  const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');

  // ON CONFLICT update — refer to EXCLUDED.<col> so the upsert path gets the
  // same values without re-binding parameters. updated_at + checked_at are
  // touched by the trigger; updated_by we set explicitly here.
  const updateAssigns = [
    ...setKeys.map((col) => `${col} = EXCLUDED.${col}`),
    'updated_by = EXCLUDED.updated_by',
  ].join(', ');

  const sql = `
    INSERT INTO unfound_overlay (${insertCols.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (organization_id, source_kind, source_id) DO UPDATE
      SET ${updateAssigns}
    RETURNING
      id, organization_id, source_kind, source_id,
      zendesk_ticket_id, zendesk_synced_at::text AS zendesk_synced_at,
      usa_team_note, vietnam_team_note,
      follow_up_at::text AS follow_up_at,
      checked, checked_at::text AS checked_at,
      updated_at::text AS updated_at, updated_by
  `;

  const result = await pool.query(sql, insertVals);

  after(async () => {
    try {
      await invalidateCacheTags(['unfound-queue']);
    } catch (err) {
      console.warn('unfound-queue PATCH: cache invalidation failed', err);
    }
  });

  return NextResponse.json({ success: true, overlay: result.rows[0] ?? null });
}, { permission: 'receiving.view' });
