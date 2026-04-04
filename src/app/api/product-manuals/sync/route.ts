import { NextResponse } from 'next/server';
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

function deriveDisplayName(fileName: string) {
  return String(fileName || '')
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function POST() {
  try {
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
      });
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
        });
        createdOrUpdated += 1;
      }
    }

    const existing = await getAllProductManuals({ limit: 10000, offset: 0 });
    for (const record of existing) {
      const relativePath = String(record.relative_path || '').trim();
      if (!relativePath) continue;
      if (seenPaths.has(relativePath)) continue;
      if (record.status === 'archived') continue;

      await updateProductManual({
        id: Number(record.id),
        status: 'archived',
      });
      archived += 1;
    }

    await invalidateCacheTags(['product-manuals', 'pm:manuals']);

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
