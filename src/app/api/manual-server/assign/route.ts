import { NextRequest, NextResponse } from 'next/server';
import { assignManualServerManual, normalizeManualServerItemNumber } from '@/lib/manual-server';
import {
  getProductManualByRelativePath,
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const relativePath = String(body?.relativePath || '').trim();
    const itemNumber = normalizeManualServerItemNumber(String(body?.itemNumber || body?.item_number || ''));
    const productTitle = String(body?.productTitle || body?.product_title || '').trim() || null;
    const displayName = String(body?.displayName || body?.display_name || '').trim() || null;
    const sourceUrl = String(body?.sourceUrl || body?.source_url || '').trim() || null;
    const assignedBy = String(body?.assignedBy || body?.assigned_by || '').trim() || null;
    const type = String(body?.type || '').trim() || null;

    if (!relativePath) {
      return NextResponse.json({ success: false, error: 'relativePath is required' }, { status: 400 });
    }
    if (!itemNumber) {
      return NextResponse.json({ success: false, error: 'itemNumber is required' }, { status: 400 });
    }

    const existing = await getProductManualByRelativePath(relativePath);
    const payload = await assignManualServerManual({ relativePath, itemNumber });
    const fileName = String(payload.relativePath.split('/').pop() || '').trim();

    const manual = existing
      ? await updateProductManual({
        id: Number(existing.id),
        itemNumber,
        productTitle: productTitle ?? existing.product_title ?? null,
        displayName: displayName ?? existing.display_name ?? deriveDisplayName(fileName),
        sourceUrl: sourceUrl ?? existing.source_url ?? null,
        relativePath: payload.relativePath,
        folderPath: payload.folderPath,
        fileName,
        status: 'assigned',
        assignedBy: assignedBy ?? existing.assigned_by ?? null,
        type: type ?? existing.type ?? null,
        isActive: true,
      })
      : await upsertProductManual({
        itemNumber,
        productTitle,
        displayName: displayName ?? deriveDisplayName(fileName),
        sourceUrl,
        relativePath: payload.relativePath,
        folderPath: payload.folderPath,
        fileName,
        status: 'assigned',
        assignedBy,
        type,
      });

    await invalidateCacheTags(['product-manuals', 'pm:manuals']);

    return NextResponse.json(
      { ...payload, manual },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to assign manual' },
      { status: 500 },
    );
  }
}
