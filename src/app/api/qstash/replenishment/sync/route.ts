import { NextRequest, NextResponse } from 'next/server';
import { isQStashOrigin } from '@/lib/qstash';
import { runReplenishmentSync } from '@/lib/replenishment';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  // Allow QStash-origin (scheduled cron) or same-origin manual trigger from /replenish sidebar
  if (!isQStashOrigin(request.headers)) {
    const origin = request.headers.get('origin') || '';
    const host = request.headers.get('host') || '';
    const isSameOrigin = origin.includes(host) || origin.includes('localhost');
    if (!isSameOrigin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    console.log('[qstash/replenishment/sync] Starting sync...');
    await runReplenishmentSync();
    console.log('[qstash/replenishment/sync] Sync completed');
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[qstash/replenishment/sync]', error);
    return NextResponse.json(
      { ok: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'replenishment-sync' });
}
