import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { getAppBaseUrl } from '@/lib/qstash';
import { orderSyncService, type ChannelOrder } from '@/services/OrderSyncService';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handleZohoOrderIngest(request: NextRequest) {
  const body = (await request.json()) as ChannelOrder;
  const order = await orderSyncService.ingestExternalOrder(body);
  return NextResponse.json({
    success: true,
    queue: 'qstash',
    job: 'zoho-order-ingest',
    order,
  });
}

export const POST = verifySignatureAppRouter(handleZohoOrderIngest, {
  url: `${getAppBaseUrl()}/api/qstash/zoho/orders/ingest`,
});

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'zoho-order-ingest' });
}
