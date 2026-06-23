import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import {
  deleteFolder,
  moveFolder,
  renameFolder,
  FolderConflictError,
  FolderCycleError,
  type PhotoFolderRow,
} from '@/lib/photos/folders';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * PATCH /api/photos/folders/[id] — rename and/or move/reorder a folder.
 * Body: { name?, parentId?, sortIndex? }. `parentId: null` moves to the root.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'photos.manage');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id == null) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    const orgId = gate.ctx.organizationId;

    const body = (await req.json().catch(() => ({}))) as {
      name?: unknown;
      parentId?: unknown;
      sortIndex?: unknown;
    };

    const wantsRename = typeof body.name === 'string';
    const wantsMove = 'parentId' in body || 'sortIndex' in body;
    if (!wantsRename && !wantsMove) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    let folder: PhotoFolderRow | null = null;

    if (wantsRename) {
      const name = (body.name as string).trim();
      if (!name) return NextResponse.json({ error: 'A folder name is required' }, { status: 400 });
      if (name.length > 120) return NextResponse.json({ error: 'Folder name is too long' }, { status: 400 });
      folder = await renameFolder(orgId, id, name);
      if (!folder) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      await recordAudit(pool, gate.ctx, req, {
        source: 'photo-folders-api',
        action: AUDIT_ACTION.PHOTO_FOLDER_RENAME,
        entityType: AUDIT_ENTITY.PHOTO_FOLDER,
        entityId: id,
        after: { name: folder.name },
      });
    }

    if (wantsMove) {
      const parentId =
        'parentId' in body
          ? body.parentId == null
            ? null
            : Number(body.parentId)
          : undefined;
      if (parentId != null && parentId !== undefined && (!Number.isFinite(parentId) || parentId <= 0)) {
        return NextResponse.json({ error: 'Invalid parentId' }, { status: 400 });
      }
      const sortIndex =
        'sortIndex' in body && body.sortIndex != null ? Number(body.sortIndex) : undefined;
      if (sortIndex !== undefined && !Number.isFinite(sortIndex)) {
        return NextResponse.json({ error: 'Invalid sortIndex' }, { status: 400 });
      }
      folder = await moveFolder(orgId, id, { parentId, sortIndex });
      if (!folder) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      await recordAudit(pool, gate.ctx, req, {
        source: 'photo-folders-api',
        action: AUDIT_ACTION.PHOTO_FOLDER_MOVE,
        entityType: AUDIT_ENTITY.PHOTO_FOLDER,
        entityId: id,
        after: { parentId: folder.parentId, sortIndex: folder.sortIndex },
      });
    }

    return NextResponse.json({ folder });
  } catch (error) {
    if (error instanceof FolderConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof FolderCycleError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('PATCH /api/photos/folders/[id] failed:', error);
    return NextResponse.json({ error: 'Failed to update folder' }, { status: 500 });
  }
}

/** DELETE /api/photos/folders/[id] — delete a folder; subfolders + assignments cascade. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'photos.manage');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id == null) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

    const ok = await deleteFolder(gate.ctx.organizationId, id);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await recordAudit(pool, gate.ctx, req, {
      source: 'photo-folders-api',
      action: AUDIT_ACTION.PHOTO_FOLDER_DELETE,
      entityType: AUDIT_ENTITY.PHOTO_FOLDER,
      entityId: id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/photos/folders/[id] failed:', error);
    return NextResponse.json({ error: 'Failed to delete folder' }, { status: 500 });
  }
}
