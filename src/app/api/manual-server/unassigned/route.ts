import { NextResponse } from 'next/server';
import { fetchManualServerUnassigned } from '@/lib/manual-server';
import { withAuth } from '@/lib/auth/withAuth';

export const GET = withAuth(async () => {
  try {
    const payload = await fetchManualServerUnassigned();
    return NextResponse.json({ success: true, ...payload }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch unassigned manuals' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.view' });
