/**
 * /api/nav — the per-org navigation override (operator-surfaces refactor
 * Phase 4, "navigation as data").
 *
 * GET  → the org's active nav override (or null). Gated `dashboard.view`: every
 *        signed-in user needs it to render their sidebar. The override only
 *        hides/renames/reorders existing nav items (mergeOrgNav enforces), so it
 *        can't leak a surface the user isn't permitted — permission filtering
 *        still applies client-side after the merge.
 * PUT  → publish a new active override (owner action). Gated `studio.manage`
 *        with step-up, matching the Studio edit model. Deactivate + activate in
 *        one transaction (the station-publish CTE pattern), then recordAudit.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import { parseNavDefinition } from '@/lib/nav/org-nav';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  try {
    const { rows } = await tenantQuery<{ config: unknown; version: number }>(
      ctx.organizationId,
      `SELECT config, version FROM nav_definitions
        WHERE organization_id = $1 AND is_active = TRUE
        ORDER BY version DESC LIMIT 1`,
      [ctx.organizationId],
    );
    const definition = rows[0] ? parseNavDefinition(rows[0].config) : null;
    return NextResponse.json({ success: true, definition, version: rows[0]?.version ?? null });
  } catch (error) {
    return errorResponse(error, 'GET /api/nav');
  }
}, { permission: 'dashboard.view' });

export const PUT = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const definition = parseNavDefinition(raw);
    if (!definition) {
      return NextResponse.json(
        { success: false, error: 'INVALID_NAV_DEFINITION', hint: 'expected { entries: [...] }' },
        { status: 422 },
      );
    }

    const published = await withTenantTransaction(ctx.organizationId, async (client) => {
      // Deactivate the current active row + insert the next version active, in
      // one statement, so two concurrent publishes can't both stay active.
      const { rows } = await client.query<{ id: number; version: number }>(
        `WITH deactivated AS (
           UPDATE nav_definitions
              SET is_active = FALSE, updated_at = NOW()
            WHERE organization_id = $1 AND is_active = TRUE
            RETURNING version
         )
         INSERT INTO nav_definitions (organization_id, config, version, is_active, updated_by)
         VALUES (
           $1, $2::jsonb,
           COALESCE((SELECT MAX(version) FROM nav_definitions WHERE organization_id = $1), 0) + 1,
           TRUE, $3
         )
         RETURNING id, version`,
        [ctx.organizationId, JSON.stringify(definition), ctx.staffId],
      );
      const row = rows[0];
      if (!row) return null;
      await recordAudit(client, ctx, req, {
        source: 'nav-api',
        action: AUDIT_ACTION.NAV_PUBLISH,
        entityType: AUDIT_ENTITY.NAV_DEFINITION,
        entityId: row.id,
        after: { version: row.version, entries: definition.entries.length },
      });
      return row;
    });

    if (!published) {
      return NextResponse.json({ success: false, error: 'Publish produced no row' }, { status: 500 });
    }
    return NextResponse.json({ success: true, id: published.id, version: published.version });
  } catch (error) {
    return errorResponse(error, 'PUT /api/nav');
  }
}, { permission: 'studio.manage', stepUp: true });
