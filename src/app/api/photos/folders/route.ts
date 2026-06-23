import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { createFolder, listFolders, FolderConflictError } from '@/lib/photos/folders';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET /api/photos/folders — every master folder for the org (flat; UI builds the tree). */
export const GET = withAuth(async (_req: NextRequest, ctx) => {
  try {
    const folders = await listFolders(ctx.organizationId);
    return NextResponse.json({ folders });
  } catch (error) {
    console.error('GET /api/photos/folders failed:', error);
    return NextResponse.json({ error: 'Failed to load folders' }, { status: 500 });
  }
}, { permission: 'photos.view' });

/** POST /api/photos/folders — create a folder. Body: { name, parentId? }. */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: unknown;
      parentId?: unknown;
    };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'A folder name is required' }, { status: 400 });
    }
    if (name.length > 120) {
      return NextResponse.json({ error: 'Folder name is too long' }, { status: 400 });
    }
    const parentId =
      body.parentId == null ? null : Number(body.parentId);
    if (parentId != null && (!Number.isFinite(parentId) || parentId <= 0)) {
      return NextResponse.json({ error: 'Invalid parentId' }, { status: 400 });
    }

    const folder = await createFolder(ctx.organizationId, { name, parentId });

    await recordAudit(pool, ctx, req, {
      source: 'photo-folders-api',
      action: AUDIT_ACTION.PHOTO_FOLDER_CREATE,
      entityType: AUDIT_ENTITY.PHOTO_FOLDER,
      entityId: folder.id,
      after: { name: folder.name, parentId: folder.parentId },
    });

    return NextResponse.json({ folder }, { status: 201 });
  } catch (error) {
    if (error instanceof FolderConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('POST /api/photos/folders failed:', error);
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 500 });
  }
}, { permission: 'photos.manage' });
