/**
 * /api/stations — station-builder definitions (Operations Studio layer 2).
 *
 * GET  ?page=receiving — the active definition per (page, mode), plus the
 *      latest draft per mode for holders of `stations.manage`. Gated
 *      `dashboard.view`: any signed-in staff member needs the active configs
 *      to render their station pages; per-block visibility is enforced at
 *      render time by each block's required/bound-action permissions.
 *
 * POST — save a DRAFT for (pageKey, modeKey). Upsert semantics make retries
 *      idempotent: if a newer-than-active draft row already exists it is
 *      updated in place; otherwise a new version row (is_active=false) is
 *      inserted. Publishing is a separate explicit step (/api/stations/publish)
 *      — the active version is never mutated here.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';
import { parseBody } from '@/lib/schemas/parse';
import { StationDraftSaveBody } from '@/lib/schemas/stations';
import { validateStationConfig } from '@/lib/stations/validate';
import type { StationConfig } from '@/lib/stations/contract';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

export const dynamic = 'force-dynamic';

interface DbRow {
  id: number;
  page_key: string;
  mode_key: string;
  label: string;
  workflow_node_id: string | null;
  config: StationConfig;
  version: number;
  is_active: boolean;
  updated_by: number | null;
  updated_at: string;
}

function toApi(row: DbRow) {
  return {
    id: row.id,
    pageKey: row.page_key,
    modeKey: row.mode_key,
    label: row.label,
    workflowNodeId: row.workflow_node_id,
    config: row.config,
    version: row.version,
    isActive: row.is_active,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const page = (req.nextUrl.searchParams.get('page') || '').trim();
    if (!page) {
      return NextResponse.json({ success: false, error: 'page is required' }, { status: 400 });
    }

    // Active rows + the single newest row per mode (the draft candidate).
    const { rows } = await pool.query<DbRow>(
      `SELECT DISTINCT ON (mode_key, is_active)
              id, page_key, mode_key, label, workflow_node_id, config,
              version, is_active, updated_by, updated_at::text
         FROM station_definitions
        WHERE organization_id = $1 AND page_key = $2
        ORDER BY mode_key, is_active, version DESC`,
      [ctx.organizationId, page],
    );

    const active = rows.filter((r) => r.is_active).map(toApi);
    const canManage = ctx.permissions.has('stations.manage');
    // A "draft" is the newest non-active row strictly newer than the mode's
    // active version (or any non-active row when nothing is published yet).
    const drafts = canManage
      ? rows
          .filter((r) => !r.is_active)
          .filter((r) => {
            const act = active.find((a) => a.modeKey === r.mode_key);
            return !act || r.version > act.version;
          })
          .map(toApi)
      : [];

    return NextResponse.json({ success: true, definitions: active, drafts, canManage });
  } catch (error) {
    return errorResponse(error, 'GET /api/stations');
  }
}, { permission: 'dashboard.view' });

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(StationDraftSaveBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const issues = validateStationConfig(parsed.config as StationConfig);
    if (issues.length > 0) {
      return NextResponse.json(
        { success: false, error: 'INVALID_CONFIG', issues },
        { status: 422 },
      );
    }

    // One statement, atomic: update the existing newer-than-active draft in
    // place, or insert a new version row. (No multi-statement transaction —
    // see the publish route for the same constraint.) Idempotency-Key headers
    // are intentionally not honored: the upsert IS the idempotency story — a
    // retried save lands on the same draft row, and a surplus version row in
    // the worst race is harmless (publish targets an explicit id).
    const { rows } = await pool.query<DbRow>(
      `WITH active AS (
         SELECT COALESCE(MAX(version), 0) AS v
           FROM station_definitions
          WHERE organization_id = $1 AND page_key = $2 AND mode_key = $3 AND is_active
       ),
       existing_draft AS (
         SELECT sd.id
           FROM station_definitions sd, active
          WHERE sd.organization_id = $1 AND sd.page_key = $2 AND sd.mode_key = $3
            AND NOT sd.is_active AND sd.version > active.v
          ORDER BY sd.version DESC
          LIMIT 1
       ),
       updated AS (
         UPDATE station_definitions sd
            SET label = $4, workflow_node_id = $5, config = $6::jsonb,
                updated_by = $7, updated_at = NOW()
           FROM existing_draft d
          WHERE sd.id = d.id
          RETURNING sd.*
       ),
       inserted AS (
         INSERT INTO station_definitions
                (organization_id, page_key, mode_key, label, workflow_node_id,
                 config, version, is_active, updated_by)
         SELECT $1, $2, $3, $4, $5, $6::jsonb,
                (SELECT COALESCE(MAX(version), 0) + 1 FROM station_definitions
                  WHERE organization_id = $1 AND page_key = $2 AND mode_key = $3),
                FALSE, $7
          WHERE NOT EXISTS (SELECT 1 FROM existing_draft)
         RETURNING *
       )
       SELECT id, page_key, mode_key, label, workflow_node_id, config,
              version, is_active, updated_by, updated_at::text
         FROM updated
       UNION ALL
       SELECT id, page_key, mode_key, label, workflow_node_id, config,
              version, is_active, updated_by, updated_at::text
         FROM inserted`,
      [
        ctx.organizationId,
        parsed.pageKey,
        parsed.modeKey,
        parsed.label,
        parsed.workflowNodeId ?? null,
        JSON.stringify(parsed.config),
        ctx.staffId,
      ],
    );

    const draft = rows[0];
    if (!draft) {
      return NextResponse.json(
        { success: false, error: 'Draft upsert produced no row' },
        { status: 500 },
      );
    }
    await recordAudit(pool, ctx, req, {
      source: 'stations-api',
      action: AUDIT_ACTION.STATION_DRAFT_SAVE,
      entityType: AUDIT_ENTITY.STATION_DEFINITION,
      entityId: draft.id,
      after: { pageKey: draft.page_key, modeKey: draft.mode_key, version: draft.version },
    });

    return NextResponse.json({ success: true, draft: toApi(draft) });
  } catch (error) {
    return errorResponse(error, 'POST /api/stations');
  }
}, { permission: 'stations.manage' });
