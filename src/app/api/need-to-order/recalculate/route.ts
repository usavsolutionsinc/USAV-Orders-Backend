import { NextRequest, NextResponse } from 'next/server';
import { requireInternalToken } from '@/lib/internal-api';
import { runReplenishmentSync } from '@/lib/replenishment';

export async function POST(req: NextRequest) {
  const authError = requireInternalToken(req);
  if (authError) return authError;

  try {
    await runReplenishmentSync();
    return NextResponse.json({ success: true, message: 'Replenishment sync completed' });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to recalculate replenishment data', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
