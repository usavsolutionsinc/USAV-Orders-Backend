import { NextRequest, NextResponse } from 'next/server';
import { upsertProductManual } from '@/lib/product-manuals';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const manual = await upsertProductManual({
      sku: String(body?.sku || ''),
      itemNumber: String(body?.itemNumber || body?.item_number || ''),
      googleDocIdOrUrl: String(body?.googleDocId || body?.google_file_id || body?.googleLinkOrFileId || ''),
      type: body?.type,
    });

    return NextResponse.json({ success: true, manual }, { status: 201 });
  } catch (error: any) {
    const message = error?.message || 'Failed to upsert product manual';
    const status = /required|valid/i.test(message) ? 400 : 500;

    console.error('Error upserting product manual:', error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
