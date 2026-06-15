import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { parseBody } from '@/lib/schemas/parse';
import { FailureTagCreateBody, FailureTagPatchBody } from '@/lib/schemas/failure-modes';
import {
  listUnitFailureTags,
  tagUnitFailure,
  resolveUnitFailureTag,
} from '@/lib/neon/failure-modes-queries';
import { recomputeUnitQualitySafe } from '@/lib/neon/quality-queries';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

/** .../api/serial-units/[id]/failure-tags → id is segments[-2]. */
function unitIdFromPath(pathname: string): number {
  const segments = pathname.split('/').filter(Boolean);
  return Number(segments[segments.length - 2]);
}

/**
 * Org-ownership 404 gate for the path unit. serial_units is tenant-owned, so a
 * cross-tenant serial_unit id matches zero rows → caller gets a 404, never a
 * 403, and never learns whether the id exists in another tenant.
 */
async function unitExistsInOrg(serialUnitId: number, orgId: OrgId): Promise<boolean> {
  const r = await tenantQuery<{ id: number }>(
    orgId,
    `SELECT id FROM serial_units WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [serialUnitId, orgId],
  );
  return r.rows.length > 0;
}

/** GET — all failure tags for a unit (open first), joined to the taxonomy. */
export const GET = withAuth(async (request, ctx) => {
  const serialUnitId = unitIdFromPath(request.nextUrl.pathname);
  if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid serial_unit id' }, { status: 400 });
  }
  try {
    // Org-scoped read: listUnitFailureTags joins serial_units and filters by
    // organization_id, so a cross-tenant unit yields an empty list.
    const tags = await listUnitFailureTags(serialUnitId, ctx.organizationId);
    return NextResponse.json({ ok: true, tags });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to load failure tags';
    console.error('[GET /api/serial-units/[id]/failure-tags] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'sku_stock.view' });

/** POST — manually tag a failure mode on a unit (idempotent per open mode). */
export const POST = withAuth(async (request, ctx) => {
  const serialUnitId = unitIdFromPath(request.nextUrl.pathname);
  if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid serial_unit id' }, { status: 400 });
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = parseBody(FailureTagCreateBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  const orgId = ctx.organizationId;

  try {
    // Org-ownership 404 gate before any write: unit_failure_tags has no org
    // column, so isolation depends entirely on the serial_units org check.
    if (!(await unitExistsInOrg(serialUnitId, orgId))) {
      return NextResponse.json({ ok: false, error: 'unit not found' }, { status: 404 });
    }
    // tagUnitFailure also gates the INSERT on serial_units.organization_id when
    // orgId is threaded (defense in depth).
    const tag = await tagUnitFailure({
      serialUnitId,
      failureModeId: parsed.failureModeId,
      detectedByStaffId: ctx.staffId,
      source: parsed.source ?? 'manual',
      notes: parsed.notes ?? null,
    }, orgId);

    await recordAudit(pool, ctx, request, {
      source: 'serial-unit-failure-tags',
      action: AUDIT_ACTION.FAILURE_TAG_ADD,
      entityType: AUDIT_ENTITY.SERIAL_UNIT,
      entityId: serialUnitId,
      method: 'manual',
      extra: { failure_mode_id: parsed.failureModeId, tag_id: tag?.id ?? null, source: parsed.source ?? 'manual' },
    });

    await recomputeUnitQualitySafe(serialUnitId);
    return NextResponse.json({ ok: true, tag }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to tag failure';
    console.error('[POST /api/serial-units/[id]/failure-tags] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'tech.qc_pass' });

/** PATCH — resolve / scrap / reopen a tag. Body: { tagId, resolutionStatus, notes? } */
export const PATCH = withAuth(async (request, ctx) => {
  const serialUnitId = unitIdFromPath(request.nextUrl.pathname);
  if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid serial_unit id' }, { status: 400 });
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = parseBody(FailureTagPatchBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  const orgId = ctx.organizationId;

  try {
    // Org-ownership 404 gate on the path unit first (serial_units is the only
    // org-bearing anchor — unit_failure_tags has no organization_id column).
    if (!(await unitExistsInOrg(serialUnitId, orgId))) {
      return NextResponse.json({ ok: false, error: 'unit not found' }, { status: 404 });
    }
    // Validate the tag actually belongs to THIS unit AND this org before
    // mutating — closes the cross-tenant-by-id leak where any tech could
    // resolve/scrap any org's tag by enumerating tag ids. The serial_units join
    // carries the org predicate (unit_failure_tags itself has no org column).
    const owns = await tenantQuery<{ id: number }>(
      orgId,
      `SELECT t.id
         FROM unit_failure_tags t
         JOIN serial_units su ON su.id = t.serial_unit_id
        WHERE t.id = $1
          AND t.serial_unit_id = $2
          AND su.organization_id = $3
        LIMIT 1`,
      [parsed.tagId, serialUnitId, orgId],
    );
    if (owns.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'tag not found' }, { status: 404 });
    }

    // resolveUnitFailureTag re-applies the org predicate (EXISTS on
    // serial_units.organization_id) so the UPDATE itself is org-scoped.
    const tag = await resolveUnitFailureTag(parsed.tagId, parsed.resolutionStatus, parsed.notes ?? null, orgId);
    if (!tag) {
      return NextResponse.json({ ok: false, error: 'tag not found' }, { status: 404 });
    }

    await recordAudit(pool, ctx, request, {
      source: 'serial-unit-failure-tags',
      action: AUDIT_ACTION.FAILURE_TAG_RESOLVE,
      entityType: AUDIT_ENTITY.SERIAL_UNIT,
      entityId: serialUnitId,
      method: 'manual',
      extra: { tag_id: parsed.tagId, resolution_status: parsed.resolutionStatus },
    });

    await recomputeUnitQualitySafe(serialUnitId);
    return NextResponse.json({ ok: true, tag });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to update failure tag';
    console.error('[PATCH /api/serial-units/[id]/failure-tags] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'tech.qc_pass' });
