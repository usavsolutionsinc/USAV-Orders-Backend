import { NextRequest, NextResponse } from 'next/server';
import { upsertProductManual } from '@/lib/product-manuals';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const manual = await upsertProductManual({
      sku: String(body?.sku || ''),
      itemNumber: String(body?.itemNumber || body?.item_number || ''),
      googleDocIdOrUrl: String(body?.googleDocId || body?.google_file_id || body?.googleLinkOrFileId || ''),
      type: body?.type,
    });

    // Invalidate all by-category combined caches so the next page load reflects the new manual
    await invalidateCacheTags(['pm:manuals']);

    return NextResponse.json({ success: true, manual }, { status: 201 });
  } catch (error: any) {
    const message = error?.message || 'Failed to assign product manual';
    const status = /required|valid/i.test(message) ? 400 : 500;

    console.error('Error assigning product manual:', error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
