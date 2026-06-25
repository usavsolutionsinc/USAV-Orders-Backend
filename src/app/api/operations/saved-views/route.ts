import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import {
  listOperationsSavedViews,
  createOperationsSavedView,
} from '@/lib/operations/saved-views-queries';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

/**
 * GET  /api/operations/saved-views — the caller's own + org-shared journey views.
 * POST /api/operations/saved-views — create a named view (personal by default).
 *
 * A saved view is a personal, read-only filter preset over data the caller can
 * already see; the ownership boundary is `staff_id`, so create is gated on the
 * same `operations.view` read permission (no new RBAC permission).
 */

export const GET = withAuth(
  async (_req: NextRequest, ctx) => {
    try {
      const views = await listOperationsSavedViews(ctx.organizationId, ctx.staffId);
      return NextResponse.json({ success: true, views });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list saved views';
      console.error('[GET /api/operations/saved-views] error:', error);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  },
  { permission: 'operations.view' },
);

export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (!name) {
        return NextResponse.json({ success: false, error: 'A view name is required' }, { status: 400 });
      }
      const filters =
        raw.filters && typeof raw.filters === 'object' ? (raw.filters as Record<string, unknown>) : {};
      if (JSON.stringify(filters).length > 8192) {
        return NextResponse.json({ success: false, error: 'Filter payload too large' }, { status: 400 });
      }
      const isShared = raw.isShared === true;
      const sortOrder = Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : 0;

      const view = await createOperationsSavedView(
        { name, filters, isShared, sortOrder },
        ctx.organizationId,
        ctx.staffId,
      );

      await recordAudit(pool, ctx, req, {
        source: 'operations-saved-views-api',
        action: AUDIT_ACTION.OPERATIONS_SAVED_VIEW_CREATE,
        entityType: AUDIT_ENTITY.OPERATIONS_SAVED_VIEW,
        entityId: view.id,
        after: { ...view },
      });

      return NextResponse.json({ success: true, view }, { status: 201 });
    } catch (error: unknown) {
      // Unique (org, staff, name) collision → friendly 409.
      if ((error as { code?: string })?.code === '23505') {
        return NextResponse.json(
          { success: false, error: 'A view with that name already exists' },
          { status: 409 },
        );
      }
      const message = error instanceof Error ? error.message : 'Failed to create saved view';
      console.error('[POST /api/operations/saved-views] error:', error);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  },
  { permission: 'operations.view' },
);
