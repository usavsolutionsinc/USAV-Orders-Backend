import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { getAppBaseUrl } from '@/lib/qstash';
import { runIdempotencyCleanup } from '@/lib/jobs/idempotency-cleanup';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function handleCleanup(_request: NextRequest) {
  const result = await runIdempotencyCleanup();
  console.log(`[idempotency-cleanup] deleted ${result.deletedRows} rows in ${result.durationMs}ms`);
  return NextResponse.json(result);
}

export const POST = verifySignatureAppRouter(handleCleanup, {
  url: `${getAppBaseUrl()}/api/qstash/cleanup/idempotency`,
});

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'idempotency-cleanup' });
}
