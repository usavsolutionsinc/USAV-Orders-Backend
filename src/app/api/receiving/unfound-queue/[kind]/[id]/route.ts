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

  let result;
  try {
    result = await pool.query(sql, insertVals);
  } catch (err) {
    // Surface Postgres errors with their code so the client can show
    // something better than a generic "update failed". 23502 = NOT NULL,
    // 23503 = FK violation (most likely cause: ctx.staffId not in staff),
    // 23514 = CHECK violation, 42P01 = table missing (migration not run).
    const pgErr = err as { code?: string; message?: string; detail?: string };
    console.error(
      `[unfound-queue.PATCH] upsert failed kind=${kind} source_id=${sourceId} keys=[${setKeys.join(',')}]`,
      { code: pgErr.code, message: pgErr.message, detail: pgErr.detail },
    );
    return NextResponse.json(
      {
        success: false,
        error: `db error: ${pgErr.message ?? 'unknown'}`,
        code: pgErr.code,
        detail: pgErr.detail,
      },
      { status: 500 },
    );
  }

  after(async () => {
    try {
      await invalidateCacheTags(['unfound-queue']);
    } catch (err) {
      console.warn('unfound-queue PATCH: cache invalidation failed', err);
    }
  });

  return NextResponse.json({ success: true, overlay: result.rows[0] ?? null });
}, { permission: 'receiving.view' });

// ─── DELETE — hard-remove the source row from the queue ──────────────────────
//
// Per kind:
//   • email_po           → DELETE FROM email_missing_purchase_orders
//   • station_exception  → DELETE FROM orders_exceptions
//   • unmatched_receiving → 422 (destructive — receiving rows may have lines/
//                           serial_units; operator should use Check or open
//                           the workspace to delete carefully)
//
// Always cleans up the matching unfound_overlay row so a re-ingested email
// doesn't inherit stale notes/Zendesk references.

export const DELETE = withAuth(async (request: NextRequest, ctx) => {
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

  if (kind === 'unmatched_receiving') {
    return NextResponse.json(
      {
        success: false,
        error:
          'Unmatched receiving rows can have attached lines + serials. Use Check to remove from the queue, or open the workspace to delete carefully.',
        code: 'UNMATCHED_RECEIVING_DELETE_BLOCKED',
      },
      { status: 422 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let deleted = 0;
    if (kind === 'email_po') {
      const res = await client.query(
        `DELETE FROM email_missing_purchase_orders
          WHERE id = $1 AND organization_id = $2`,
        [sourceId, ctx.organizationId],
      );
      deleted = res.rowCount ?? 0;
    } else if (kind === 'station_exception') {
      // orders_exceptions.id is INTEGER; the URL carries it as string.
      const numericId = Number(sourceId);
      if (!Number.isFinite(numericId) || numericId <= 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { success: false, error: 'station_exception id must be numeric' },
          { status: 400 },
        );
      }
      const res = await client.query(
        `DELETE FROM orders_exceptions
          WHERE id = $1 AND organization_id = $2`,
        [numericId, ctx.organizationId],
      );
      deleted = res.rowCount ?? 0;
    }

    if (deleted === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, error: 'source row not found' },
        { status: 404 },
      );
    }

    // Best-effort overlay cleanup. If no overlay row exists, this is a no-op.
    await client.query(
      `DELETE FROM unfound_overlay
        WHERE organization_id = $1
          AND source_kind = $2
          AND source_id = $3`,
      [ctx.organizationId, kind, sourceId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    const pgErr = err as { code?: string; message?: string };
    console.error(
      `[unfound-queue.DELETE] failed kind=${kind} source_id=${sourceId}`,
      { code: pgErr.code, message: pgErr.message },
    );
    return NextResponse.json(
      { success: false, error: `delete failed: ${pgErr.message ?? 'unknown'}` },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  after(async () => {
    try {
      await invalidateCacheTags(['unfound-queue']);
    } catch (err) {
      console.warn('unfound-queue DELETE: cache invalidation failed', err);
    }
  });

  return NextResponse.json({ success: true });
}, { permission: 'receiving.view' });
