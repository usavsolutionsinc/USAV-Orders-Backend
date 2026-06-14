import { NextRequest, NextResponse } from 'next/server';
import {
  deactivateSourcingSearch,
  getSourcingSearchById,
  updateSourcingSearch,
} from '@/lib/neon/sourcing-searches-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { SavedSearchUpdateBody } from '@/lib/schemas/sourcing';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

/**
 * PATCH /api/sourcing/saved-searches/[id] — edit query/scope, retarget cadence,
 * or pause/resume (isActive). At least one field required.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'sourcing.manage');
    if (gate.denied) return gate.denied;
    const id = Number((await params).id);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(SavedSearchUpdateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const before = await getSourcingSearchById(id);
    if (!before) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const updated = await updateSourcingSearch(id, {
      query: parsed.query,
      label: parsed.label,
      sources: parsed.sources,
      conditions: parsed.conditions,
      maxPriceCents: parsed.maxPriceCents,
      cadence: parsed.cadence,
      isActive: parsed.isActive,
    });

    await recordAudit(pool, gate.ctx, req, {
      source: 'sourcing-saved-searches-api',
      action: AUDIT_ACTION.SOURCING_SAVED_SEARCH_UPDATE,
      entityType: AUDIT_ENTITY.SOURCING_SAVED_SEARCH,
      entityId: id,
      before: { ...before },
      after: updated ? { ...updated } : null,
    });

    return NextResponse.json({ success: true, search: updated });
  } catch (error: any) {
    console.error('Error in PATCH /api/sourcing/saved-searches/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update saved search' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/sourcing/saved-searches/[id] — soft-delete (deactivate + cadence off).
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'sourcing.manage');
    if (gate.denied) return gate.denied;
    const id = Number((await params).id);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const before = await getSourcingSearchById(id);
    if (!before) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const updated = await deactivateSourcingSearch(id);

    await recordAudit(pool, gate.ctx, req, {
      source: 'sourcing-saved-searches-api',
      action: AUDIT_ACTION.SOURCING_SAVED_SEARCH_DELETE,
      entityType: AUDIT_ENTITY.SOURCING_SAVED_SEARCH,
      entityId: id,
      before: { ...before },
      after: updated ? { ...updated } : null,
    });

    return NextResponse.json({ success: true, search: updated });
  } catch (error: any) {
    console.error('Error in DELETE /api/sourcing/saved-searches/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete saved search' },
      { status: 500 },
    );
  }
}
