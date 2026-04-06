import { NextRequest, NextResponse } from 'next/server';
import { isQStashOrigin } from '@/lib/qstash';
import { runEbaySync } from '@/lib/jobs/ebay-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!isQStashOrigin(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'ebay-sync' });
}
