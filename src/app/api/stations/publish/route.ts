/**
 * POST /api/stations/publish — flip a draft station definition live.
 *
 * Body: { id } — the draft row to activate.
 *
 * Atomic by construction: one statement deactivates the (org, page, mode)'s
 * current active version and activates the target. In-flight staff pick the
 * new version up on next mount (the renderer's query refetch) — versions are
 * immutable once published, mirroring workflow_definitions semantics.
 *
 * Blocking validation runs against the registries before the flip, so a
 * config referencing a block/source/action that was removed from code since
 * the draft was saved can never go live.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';
import { parseBody } from '@/lib/schemas/parse';
import { StationPublishBody } from '@/lib/schemas/stations';
import { validateStationConfig } from '@/lib/stations/validate';
import type { StationConfig } from '@/lib/stations/contract';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(StationPublishBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const target = await pool.query<{
      id: number;
      page_key: string;
      mode_key: string;
      version: number;
      is_active: boolean;
      config: StationConfig;
    }>(
      `SELECT id, page_key, mode_key, version, is_active, config
         FROM station_definitions
        WHERE id = $1 AND organization_id = $2`,
      [parsed.id, ctx.organizationId],
    );
    const row = target.rows[0];
    if (!row) {
      return NextResponse.json({ success: false, error: 'NOT_FOUND' }, { status: 404 });
    }
    if (row.is_active) {
      // Idempotent: re-publishing the active version is a no-op success.
      // (Idempotency-Key headers intentionally unsupported — this branch IS
      // the replay path.)
      return NextResponse.json({ success: true, alreadyActive: true, id: row.id });
    }

    const issues = validateStationConfig(row.config);
    if (issues.length > 0) {
      return NextResponse.json(
        { success: false, error: 'INVALID_CONFIG', issues },
        { status: 422 },
      );
    }

    // Single atomic statement: deactivate siblings, activate the target.
    const { rows: published } = await pool.query<{ id: number; version: number }>(
      `WITH deactivated AS (
         UPDATE station_definitions
            SET is_active = FALSE, updated_at = NOW()
          WHERE organization_id = $2 AND page_key = $3 AND mode_key = $4
            AND is_active AND id <> $1
          RETURNING id
       )
       UPDATE station_definitions
          SET is_active = TRUE, updated_by = $5, updated_at = NOW()
        WHERE id = $1 AND organization_id = $2
        RETURNING id, version`,
      [parsed.id, ctx.organizationId, row.page_key, row.mode_key, ctx.staffId],
    );

    await recordAudit(pool, ctx, req, {
      source: 'stations-api',
      action: AUDIT_ACTION.STATION_PUBLISH,
      entityType: AUDIT_ENTITY.STATION_DEFINITION,
      entityId: row.id,
      after: { pageKey: row.page_key, modeKey: row.mode_key, version: row.version },
    });

    return NextResponse.json({ success: true, id: published[0]?.id ?? row.id, version: row.version });
  } catch (error) {
    return errorResponse(error, 'POST /api/stations/publish');
  }
}, { permission: 'stations.manage' });
