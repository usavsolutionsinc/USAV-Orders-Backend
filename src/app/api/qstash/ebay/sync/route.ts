import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { runEbaySync } from '@/lib/jobs/ebay-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handleEbaySync(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const reconcileExceptions =
    body?.reconcileExceptions === undefined ? true : body.reconcileExceptions === true;

  try {
    return NextResponse.json(await runEbaySync({ reconcileExceptions }));
  } catch (error: any) {
    const payload = error?.cause;
    console.error('[qstash/ebay/sync]', error);
    return NextResponse.json(
      payload ?? {
        success: false,
        error: error?.message || 'Internal error',
      },
      { status: 500 }
    );
  }
}

export const POST = verifySignatureAppRouter(handleEbaySync);

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'ebay-sync' });
}
