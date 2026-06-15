import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import {
  getHandlingUnitDetail,
  getHandlingUnitByCode,
  dissolveHandlingUnit,
} from '@/lib/neon/handling-unit-queries';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { tenantQuery } from '@/lib/tenancy/db';

/**
 * Org-ownership precheck for a resolved handling_units.id.
 *
 * `handling_units` is tenant-owned (carries organization_id), but the
 * handling-unit-queries helpers this route delegates to are not org-aware, so
 * we gate at the route boundary: GUC-wrap + explicit `organization_id = $2`
 * filter. Returns true only when the box exists AND belongs to the caller's
 * org; a cross-tenant id therefore reads as "not found" (404), never 403.
 */
async function ownsHandlingUnit(orgId: string, id: number): Promise<boolean> {
  const r = await tenantQuery<{ id: number }>(
    orgId,
    `SELECT id FROM handling_units WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [id, orgId],
  );
  return r.rows.length > 0;
}

/**
 * GET /api/handling-units/:id — box + contents + rollup status.
 *
 * Accepts a numeric handling_units.id OR an `H-{id}` / external `code` in the
 * URL segment. Returns `handling_unit` with `units`, `receiving_line_ids` (what
 * the testing resolver fans out to), and a `rollup` { total, tested, untested }.
 */
export const GET = withAuth(
  async (request: NextRequest, ctx) => {
    const raw = extractIdSegment(request.nextUrl.pathname);
    if (!raw) {
      return NextResponse.json({ success: false, error: 'handling unit id required' }, { status: 400 });
    }

    let id: number | null = /^\d+$/.test(raw) ? Number(raw) : null;
    if (id == null) {
      // `H-12` handle or external tote code → resolve to the numeric id.
      const hMatch = /^H-(\d+)$/i.exec(raw);
      if (hMatch) id = Number(hMatch[1]);
      else {
        const byCode = await getHandlingUnitByCode(raw);
        if (byCode) id = byCode.id;
      }
    }
    if (id == null || !Number.isFinite(id)) {
      return NextResponse.json({ success: false, error: 'Handling unit not found' }, { status: 404 });
    }

    // Org-ownership gate: the queries below aren't org-aware, so a cross-tenant
    // box id reads as "not found" rather than leaking another org's contents.
    if (!(await ownsHandlingUnit(ctx.organizationId, id))) {
      return NextResponse.json({ success: false, error: 'Handling unit not found' }, { status: 404 });
    }

    const detail = await getHandlingUnitDetail(id);
    if (!detail) {
      return NextResponse.json({ success: false, error: 'Handling unit not found' }, { status: 404 });
    }
    // Mirror `receiving_line_ids` at the top level too — the testing resolver
    // reads either shape.
    return NextResponse.json({
      success: true,
      handling_unit: detail,
      receiving_line_ids: detail.receiving_line_ids,
    });
  },
  { permission: 'handling_unit.view' },
);

/**
 * DELETE /api/handling-units/:id — dissolve an H-box (reverse of create).
 *
 * Unassigns every member unit (handling_unit_id → NULL) then deletes the box
 * row, so a mis-scanned / abandoned tote can be removed without orphaning its
 * units. Accepts the same numeric id / `H-{id}` / code forms as GET.
 */
export const DELETE = withAuth(
  async (request: NextRequest, ctx) => {
    const raw = extractIdSegment(request.nextUrl.pathname);
    if (!raw) {
      return NextResponse.json({ success: false, error: 'handling unit id required' }, { status: 400 });
    }
    let id: number | null = /^\d+$/.test(raw) ? Number(raw) : null;
    if (id == null) {
      const hMatch = /^H-(\d+)$/i.exec(raw);
      if (hMatch) id = Number(hMatch[1]);
      else {
        const byCode = await getHandlingUnitByCode(raw);
        if (byCode) id = byCode.id;
      }
    }
    if (id == null || !Number.isFinite(id)) {
      return NextResponse.json({ success: false, error: 'Handling unit not found' }, { status: 404 });
    }

    // Org-ownership precheck before the (non-org-aware) dissolve write — a
    // cross-tenant box id 404s instead of dissolving another org's box.
    if (!(await ownsHandlingUnit(ctx.organizationId, id))) {
      return NextResponse.json({ success: false, error: 'Handling unit not found' }, { status: 404 });
    }

    const result = await dissolveHandlingUnit(id);
    if (!result) {
      return NextResponse.json({ success: false, error: 'Handling unit not found' }, { status: 404 });
    }

    await recordAudit(pool, ctx, request, {
      source: 'handling-units-api',
      action: 'handling_unit.dissolve',
      entityType: 'handling_unit',
      entityId: id,
      before: { ...result.dissolved },
      after: null,
      note: result.unassigned > 0 ? `unassigned ${result.unassigned} unit(s)` : null,
    });

    return NextResponse.json({ success: true, unassigned: result.unassigned });
  },
  { permission: 'handling_unit.manage' },
);

function extractIdSegment(pathname: string): string {
  const m = /\/api\/handling-units\/([^/]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1] || '').trim() : '';
}
