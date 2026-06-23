import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { addPhotosToFolder, removePhotosFromFolder } from '@/lib/photos/folders';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** Pull a clean positive-int id list from a request body's `photoIds`. */
function readPhotoIds(body: unknown): number[] {
  const raw = (body as { photoIds?: unknown } | null)?.photoIds;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0))];
}

/** POST /api/photos/folders/[id]/items — assign photos to the folder. Body: { photoIds }. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'photos.manage');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const folderId = parseId(rawId);
    if (folderId == null) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

    const photoIds = readPhotoIds(await req.json().catch(() => null));
    if (photoIds.length === 0) {
      return NextResponse.json({ error: 'No photoIds provided' }, { status: 400 });
    }

    const { folderExists, added } = await addPhotosToFolder(gate.ctx.organizationId, folderId, photoIds);
    if (!folderExists) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await recordAudit(pool, gate.ctx, req, {
      source: 'photo-folders-api',
      action: AUDIT_ACTION.PHOTO_FOLDER_ASSIGN,
      entityType: AUDIT_ENTITY.PHOTO_FOLDER,
      entityId: folderId,
      after: { added, requested: photoIds.length },
    });

    return NextResponse.json({ added });
  } catch (error) {
    console.error('POST /api/photos/folders/[id]/items failed:', error);
    return NextResponse.json({ error: 'Failed to assign photos' }, { status: 500 });
  }
}

/** DELETE /api/photos/folders/[id]/items — remove photos from the folder. Body: { photoIds }. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'photos.manage');
    if (gate.denied) return gate.denied;
    const { id: rawId } = await params;
    const folderId = parseId(rawId);
    if (folderId == null) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

    const photoIds = readPhotoIds(await req.json().catch(() => null));
    if (photoIds.length === 0) {
      return NextResponse.json({ error: 'No photoIds provided' }, { status: 400 });
    }

    const removed = await removePhotosFromFolder(gate.ctx.organizationId, folderId, photoIds);

    await recordAudit(pool, gate.ctx, req, {
      source: 'photo-folders-api',
      action: AUDIT_ACTION.PHOTO_FOLDER_UNASSIGN,
      entityType: AUDIT_ENTITY.PHOTO_FOLDER,
      entityId: folderId,
      after: { removed },
    });

    return NextResponse.json({ removed });
  } catch (error) {
    console.error('DELETE /api/photos/folders/[id]/items failed:', error);
    return NextResponse.json({ error: 'Failed to remove photos' }, { status: 500 });
  }
}
