import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
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

/** GET — all failure tags for a unit (open first), joined to the taxonomy. */
export const GET = withAuth(async (request) => {
  const serialUnitId = unitIdFromPath(request.nextUrl.pathname);
  if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid serial_unit id' }, { status: 400 });
  }
  try {
    const tags = await listUnitFailureTags(serialUnitId);
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

  try {
    const tag = await tagUnitFailure({
      serialUnitId,
      failureModeId: parsed.failureModeId,
      detectedByStaffId: ctx.staffId,
      source: parsed.source ?? 'manual',
      notes: parsed.notes ?? null,
    });

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

  try {
    const tag = await resolveUnitFailureTag(parsed.tagId, parsed.resolutionStatus, parsed.notes ?? null);
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
