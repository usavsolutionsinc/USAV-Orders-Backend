import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createPairCode } from '@/lib/phone-pair';

export const runtime = 'nodejs';

async function fetchStaffName(staffId: number): Promise<string | null> {
  try {
    const r = await pool.query<{ name: string | null }>(
      'SELECT name FROM staff WHERE id = $1 LIMIT 1',
      [staffId],
    );
    const name = (r.rows[0]?.name || '').trim();
    return name || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const staffId = Number(body?.staffId ?? body?.staff_id);
    if (!Number.isFinite(staffId) || staffId <= 0) {
      return NextResponse.json({ success: false, error: 'staffId is required' }, { status: 400 });
    }

    const [{ code, ttlSeconds }, staffName] = await Promise.all([
      createPairCode(Math.floor(staffId)),
      fetchStaffName(Math.floor(staffId)),
    ]);

    // Pair URL must reach the phone's device over the public internet, so we
    // prefer the explicit prod origin (env) over the dev loopback host.
    const explicitOrigin = (
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      'https://usav-orders-backend.vercel.app'
    ).replace(/\/+$/, '');
    const origin = explicitOrigin || req.nextUrl.origin;
    const pairUrl = `${origin}/m/pair/${code}`;

    return NextResponse.json({
      success: true,
      code,
      pair_url: pairUrl,
      expires_in_seconds: ttlSeconds,
      staff_id: Math.floor(staffId),
      staff_name: staffName,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create pair code';
    console.error('pair/create POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
