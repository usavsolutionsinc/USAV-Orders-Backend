import { NextResponse } from 'next/server';
import { fetchManualServerUnassigned } from '@/lib/manual-server';

export async function GET() {
  try {
    const payload = await fetchManualServerUnassigned();
    return NextResponse.json({ success: true, ...payload }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch unassigned manuals' },
      { status: 500 },
    );
  }
}
