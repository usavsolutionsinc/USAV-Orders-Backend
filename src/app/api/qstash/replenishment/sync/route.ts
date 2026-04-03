import { NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { runReplenishmentSync } from '@/lib/replenishment';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function handleReplenishmentSync() {
  try {
    await runReplenishmentSync();
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[qstash/replenishment/sync]', error);
    return NextResponse.json(
      { ok: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}

export const POST = verifySignatureAppRouter(handleReplenishmentSync);

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'replenishment-sync' });
}
