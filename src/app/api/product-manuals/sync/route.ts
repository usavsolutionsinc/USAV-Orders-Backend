import { NextResponse, type NextRequest } from 'next/server';
import { withAuth, type AuthContext } from '@/lib/auth/withAuth';
import {
  fetchManualServerAssignedItems,
  fetchManualServerUnassigned,
  isManualServerConfigured,
} from '@/lib/manual-server';
import {
  getAllProductManuals,
  updateProductManual,
  upsertProductManual,
} from '@/lib/neon/product-manuals-queries';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { CACHE_TAGS } from '@/lib/cache/tags';

function deriveDisplayName(fileName: string) {
  return String(fileName || '')
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function handlePost(_req: NextRequest, ctx: AuthContext) {
  try {
    // Thread orgId so every upsert/update/list GUC-wraps and scopes to this
    // org. NEEDS-COL: product_manuals has no organization_id column and no RLS
    // policy yet, so getAllProductManuals here can't hard-filter by parent
    // (most synced rows are unpaired/NULL-parent) — the archive sweep below
    // still sees cross-org rows until the column/policy lands. See stillOpen.
    const orgId = ctx.organizationId ?? undefined;
    if (!isManualServerConfigured()) {
      return NextResponse.json(
        { success: false, error: 'Manual server is not configured' },
        { status: 503 },
      );
    }

    const [unassigned, assigned] = await Promise.all([
      fetchManualServerUnassigned(),
      fetchManualServerAssignedItems(),
    ]);

    let createdOrUpdated = 0;
    let archived = 0;
    const seenPaths = new Set<string>();

    for (const manual of unassigned.manuals) {
      seenPaths.add(manual.relativePath);
      await upsertProductManual({
        itemNumber: null,
        displayName: deriveDisplayName(manual.name),
        relativePath: manual.relativePath,
        folderPath: unassigned.folderPath,
        fileName: manual.name,
        status: 'unassigned',
      }, orgId);
      createdOrUpdated += 1;
    }

    for (const item of assigned.items) {
      for (const manual of item.manuals) {
        seenPaths.add(manual.relativePath);
        await upsertProductManual({
          itemNumber: item.itemNumber,
          displayName: deriveDisplayName(manual.name),
          relativePath: manual.relativePath,
          folderPath: item.folderPath,
          fileName: manual.name,
          status: 'assigned',
        }, orgId);
        createdOrUpdated += 1;
      }
    }

    const existing = await getAllProductManuals({ limit: 10000, offset: 0 }, orgId);
    for (const record of existing) {
      const relativePath = String(record.relative_path || '').trim();
      if (!relativePath) continue;
      if (seenPaths.has(relativePath)) continue;
      if (record.status === 'archived') continue;

      await updateProductManual({
        id: Number(record.id),
        status: 'archived',
      }, orgId);
      archived += 1;
    }

    await invalidateCacheTags(['product-manuals', 'pm:manuals']);
    await invalidateCacheTags(ctx.organizationId, [CACHE_TAGS.productManuals]);

    return NextResponse.json({
      success: true,
      counts: {
        unassigned: unassigned.manuals.length,
        assignedItems: assigned.items.length,
        syncedRecords: createdOrUpdated,
        archivedRecords: archived,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to sync product manuals' },
      { status: 500 },
    );
  }
}

export const POST = withAuth(handlePost, { permission: 'product_manuals.manage' });
