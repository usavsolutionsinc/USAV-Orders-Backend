import { NextResponse } from 'next/server';
import { listWarehouses } from '@/lib/warehouses';

export async function GET() {
  try {
    const rows = await listWarehouses();
    return NextResponse.json({ success: true, warehouses: rows });
  } catch (err: any) {
    console.error('[GET /api/warehouses] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed' },
      { status: 500 },
    );
  }
}
