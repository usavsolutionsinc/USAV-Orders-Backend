import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { getAppBaseUrl } from '@/lib/qstash';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function handleTransferOrders(request: NextRequest) {
  const baseUrl = getAppBaseUrl();
  const url = `${baseUrl}/api/google-sheets/transfer-orders`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }
  return NextResponse.json(data);
}

export const POST = verifySignatureAppRouter(handleTransferOrders, {
  url: `${getAppBaseUrl()}/api/qstash/google-sheets/transfer-orders`,
});

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'google-sheets-transfer-orders' });
}
