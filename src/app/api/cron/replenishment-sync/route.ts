import { NextRequest, NextResponse } from 'next/server';
import { runReplenishmentSync } from '@/lib/replenishment';

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await runReplenishmentSync();
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to run replenishment sync', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
