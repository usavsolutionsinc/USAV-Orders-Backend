import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { reorderFolders } from '@/lib/photos/folders';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/photos/folders/reorder — persist a new sibling order.
 * Body: { items: [{ id, sortIndex }, …] }. Static segment, so it resolves ahead
 * of the dynamic `[id]` route (Next prioritizes literal segments).
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = (await req.json().catch(() => ({}))) as { items?: unknown };
    const raw = Array.isArray(body.items) ? body.items : [];
    const items = raw
      .map((it) => ({
        id: Number((it as { id?: unknown })?.id),
        sortIndex: Number((it as { sortIndex?: unknown })?.sortIndex),
      }))
      .filter((it) => Number.isFinite(it.id) && it.id > 0 && Number.isFinite(it.sortIndex));

    if (items.length === 0) {
      return NextResponse.json({ error: 'No valid items to reorder' }, { status: 400 });
    }

    await reorderFolders(ctx.organizationId, items);

    await recordAudit(pool, ctx, req, {
      source: 'photo-folders-api',
      action: AUDIT_ACTION.PHOTO_FOLDER_MOVE,
      entityType: AUDIT_ENTITY.PHOTO_FOLDER,
      entityId: items[0].id,
      after: { reordered: items.length },
    });

    return NextResponse.json({ reordered: items.length });
  } catch (error) {
    console.error('POST /api/photos/folders/reorder failed:', error);
    return NextResponse.json({ error: 'Failed to reorder folders' }, { status: 500 });
  }
}, { permission: 'photos.manage' });
