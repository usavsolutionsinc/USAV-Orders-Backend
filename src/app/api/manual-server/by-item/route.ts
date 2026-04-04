import { NextRequest, NextResponse } from 'next/server';
import { fetchManualServerByItem, normalizeManualServerItemNumber } from '@/lib/manual-server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const itemNumber = normalizeManualServerItemNumber(String(searchParams.get('itemNumber') || ''));

    if (!itemNumber) {
      return NextResponse.json({ success: false, error: 'itemNumber is required' }, { status: 400 });
    }

    const payload = await fetchManualServerByItem(itemNumber);
    return NextResponse.json({ success: true, ...payload }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch manuals for item' },
      { status: 500 },
    );
  }
}
