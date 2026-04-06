import { NextRequest, NextResponse } from 'next/server';
import { isQStashOrigin } from '@/lib/qstash';
import { runIdempotencyCleanup } from '@/lib/jobs/idempotency-cleanup';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  if (!isQStashOrigin(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runIdempotencyCleanup();
    console.log(`[idempotency-cleanup] deleted ${result.deletedRows} rows in ${result.durationMs}ms`);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[qstash/cleanup/idempotency]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'idempotency-cleanup' });
}
