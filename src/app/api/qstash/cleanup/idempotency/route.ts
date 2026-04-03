import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { runIdempotencyCleanup } from '@/lib/jobs/idempotency-cleanup';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function handleCleanup(_request: NextRequest) {
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

export const POST = verifySignatureAppRouter(handleCleanup);

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'idempotency-cleanup' });
}
