import { NextRequest, NextResponse } from 'next/server';
import { listNeedToOrder } from '@/lib/replenishment';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const statuses = (searchParams.get('status') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean) as any[];
    const page = Number(searchParams.get('page') || '1');
    const limit = Number(searchParams.get('limit') || '50');

    const payload = await listNeedToOrder({ statuses, page, limit });
    return NextResponse.json(payload);
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to fetch need-to-order list', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
