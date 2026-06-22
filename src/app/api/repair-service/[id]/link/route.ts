import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  linkRepairService,
  unlinkRepairService,
  REPAIR_LINK_FIELDS,
  type RepairLinkField,
} from '@/lib/neon/repair-service-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishRepairChanged } from '@/lib/realtime/publish';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

/**
 * Manual pairing for a repair_service ticket. POST sets the linkage reference
 * fields (order id / inbound tracking / serial / catalog SKU); DELETE clears
 * them (a full unlink, or a subset via `?fields=`). Both are fully reversible
 * — the ticket row is untouched beyond these reference columns, and the prior
 * values are captured in the audit `before`. Org-scoped: a cross-tenant id
 * resolves to 404 (no disclosure). Permission: repair.intake.
 */

const linkBodySchema = z
  .object({
    source_order_id: z.string().trim().max(120).nullish(),
    source_tracking_number: z.string().trim().max(120).nullish(),
    serial_number: z.string().trim().max(120).nullish(),
    source_sku: z.string().trim().max(120).nullish(),
  })
  .refine(
    (b) => REPAIR_LINK_FIELDS.some((f) => b[f] !== undefined),
    { message: 'at least one linkage field is required' },
  );

function parseId(id: string): number | null {
  const n = parseInt(id, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'repair.intake');
    if (gate.denied) return gate.denied;
    const { id } = await params;
    const repairId = parseId(id);
    if (repairId == null) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

    const raw = await req.json().catch(() => null);
    const parsed = linkBodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid body', issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await linkRepairService(repairId, parsed.data, gate.ctx.organizationId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    await invalidateCacheTags(['repair-service']);
    await publishRepairChanged({
      organizationId: gate.ctx.organizationId,
      repairIds: [repairId],
      source: 'repair-service.link',
    });
    await recordAudit(pool, gate.ctx, req, {
      source: 'repair-service-api',
      action: AUDIT_ACTION.REPAIR_SERVICE_LINK,
      entityType: AUDIT_ENTITY.REPAIR_SERVICE,
      entityId: repairId,
      before: { ...result.before },
      after: { ...parsed.data },
    });

    return NextResponse.json({ success: true, repair: result.repair });
  } catch (error: any) {
    console.error('Error in POST /api/repair-service/[id]/link:', error);
    return NextResponse.json({ error: 'Failed to link repair', details: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'repair.intake');
    if (gate.denied) return gate.denied;
    const { id } = await params;
    const repairId = parseId(id);
    if (repairId == null) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

    // Optional ?fields=source_order_id,serial_number — clear a subset. Omitted
    // = clear every linkage field. Unknown fields are ignored by the helper.
    const fieldsParam = req.nextUrl.searchParams.get('fields');
    const fields = fieldsParam
      ? (fieldsParam
          .split(',')
          .map((f) => f.trim())
          .filter((f): f is RepairLinkField =>
            (REPAIR_LINK_FIELDS as readonly string[]).includes(f),
          ))
      : undefined;

    // unlinkRepairService captures the prior linkage values (result.before) for
    // us — no separate read needed; a missing/cross-tenant row returns 404.
    const result = await unlinkRepairService(repairId, fields, gate.ctx.organizationId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    await invalidateCacheTags(['repair-service']);
    await publishRepairChanged({
      organizationId: gate.ctx.organizationId,
      repairIds: [repairId],
      source: 'repair-service.unlink',
    });
    await recordAudit(pool, gate.ctx, req, {
      source: 'repair-service-api',
      action: AUDIT_ACTION.REPAIR_SERVICE_UNLINK,
      entityType: AUDIT_ENTITY.REPAIR_SERVICE,
      entityId: repairId,
      before: { ...result.before },
      after: { cleared: fields ?? REPAIR_LINK_FIELDS },
    });

    return NextResponse.json({ success: true, repair: result.repair });
  } catch (error: any) {
    console.error('Error in DELETE /api/repair-service/[id]/link:', error);
    return NextResponse.json({ error: 'Failed to unlink repair', details: error.message }, { status: 500 });
  }
}
