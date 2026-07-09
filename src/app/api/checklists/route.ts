import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import {
  ChecklistQuery,
  ChecklistCreateBody,
  ChecklistUpdateBody,
  ChecklistDeleteBody,
} from '@/lib/schemas/checklists';
import {
  getChecklistTemplates,
  getChecklistTemplateById,
  createChecklistTemplate,
  updateChecklistTemplate,
  deleteChecklistTemplate,
} from '@/lib/neon/checklist-queries';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

/**
 * /api/checklists — CRUD for the polymorphic `checklist_templates` table.
 *
 * Scope is addressed by `(scopeType, scopeId)`:
 *   - GLOBAL (scopeId omitted) → the org-wide receiving checklist (today's use).
 *   - CATEGORY / SKU (scopeId set) → per-category / per-SKU lists (future).
 *
 * Read is `receiving.view` (operators must see the list to fill it); authoring
 * the definitions is `sku_stock.manage` (the same capability as QC checklists).
 */

/**
 * GET /api/checklists?scopeType=GLOBAL[&scopeId=123][&publishedOnly=1]
 * Returns the scope's checklist steps in display order.
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const parsed = ChecklistQuery.safeParse({
      scopeType: req.nextUrl.searchParams.get('scopeType') ?? undefined,
      scopeId: req.nextUrl.searchParams.get('scopeId') ?? undefined,
      publishedOnly: req.nextUrl.searchParams.get('publishedOnly') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid query' }, { status: 400 });
    }
    const { scopeType, scopeId, publishedOnly } = parsed.data;
    const items = await getChecklistTemplates(
      ctx.organizationId,
      scopeType,
      scopeId ?? null,
      { publishedOnly: publishedOnly === '1' || publishedOnly === 'true' },
    );
    return NextResponse.json({ success: true, items });
  } catch (error: any) {
    console.error('Error in GET /api/checklists:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to load checklist' },
      { status: 500 },
    );
  }
}, { permission: 'receiving.view' });

/** POST /api/checklists — create a checklist step under a scope. */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(ChecklistCreateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const item = await createChecklistTemplate(
      {
        scopeType: parsed.scopeType,
        scopeId: parsed.scopeId ?? null,
        stepLabel: parsed.stepLabel,
        stepType: parsed.stepType,
        sortOrder: parsed.sortOrder,
        status: parsed.status,
      },
      ctx.organizationId,
    );

    await recordAudit(pool, ctx, req, {
      source: 'checklists-api',
      action: AUDIT_ACTION.CHECKLIST_CREATE,
      entityType: AUDIT_ENTITY.CHECKLIST_TEMPLATE,
      entityId: item.id,
      before: null,
      after: { ...item },
      extra: { scope_type: item.scope_type, scope_id: item.scope_id },
    });

    return NextResponse.json({ success: true, item }, { status: 201 });
  } catch (error: any) {
    console.error('Error in POST /api/checklists:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create checklist step' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.manage' });

/** PUT /api/checklists — update a step by id. Status-only edit → publish. */
export const PUT = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(ChecklistUpdateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    // Org-scoped before-state — a cross-org id resolves to null (→ 404).
    const before = await getChecklistTemplateById(parsed.id, ctx.organizationId);
    if (!before) {
      return NextResponse.json({ success: false, error: 'Checklist step not found' }, { status: 404 });
    }

    const updated = await updateChecklistTemplate(
      parsed.id,
      {
        stepLabel: parsed.stepLabel,
        stepType: parsed.stepType,
        sortOrder: parsed.sortOrder,
        status: parsed.status,
      },
      ctx.organizationId,
    );
    if (!updated) {
      return NextResponse.json({ success: false, error: 'No changes' }, { status: 400 });
    }

    const onlyStatus =
      parsed.status !== undefined &&
      parsed.stepLabel === undefined &&
      parsed.stepType === undefined &&
      parsed.sortOrder === undefined;

    await recordAudit(pool, ctx, req, {
      source: 'checklists-api',
      action: onlyStatus ? AUDIT_ACTION.CHECKLIST_PUBLISH : AUDIT_ACTION.CHECKLIST_UPDATE,
      entityType: AUDIT_ENTITY.CHECKLIST_TEMPLATE,
      entityId: parsed.id,
      before: before as unknown as Record<string, unknown>,
      after: { ...updated },
    });

    return NextResponse.json({ success: true, item: updated });
  } catch (error: any) {
    console.error('Error in PUT /api/checklists:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update checklist step' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.manage' });

/** DELETE /api/checklists — delete a step by id (in body). */
export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(ChecklistDeleteBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const before = await getChecklistTemplateById(parsed.id, ctx.organizationId);
    if (!before) {
      return NextResponse.json({ success: false, error: 'Checklist step not found' }, { status: 404 });
    }
    const deleted = await deleteChecklistTemplate(parsed.id, ctx.organizationId);

    if (deleted) {
      await recordAudit(pool, ctx, req, {
        source: 'checklists-api',
        action: AUDIT_ACTION.CHECKLIST_DELETE,
        entityType: AUDIT_ENTITY.CHECKLIST_TEMPLATE,
        entityId: parsed.id,
        before: before as unknown as Record<string, unknown>,
        after: null,
      });
    }
    return NextResponse.json({ success: true, deleted });
  } catch (error: any) {
    console.error('Error in DELETE /api/checklists:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete checklist step' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.manage' });
