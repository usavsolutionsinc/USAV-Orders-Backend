import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { orderSyncService, type ChannelOrder } from '@/services/OrderSyncService';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handleZohoOrderIngest(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as ChannelOrder;
  try {
    const order = await orderSyncService.ingestExternalOrder(body);
    return NextResponse.json({
      success: true,
      queue: 'qstash',
      job: 'zoho-order-ingest',
      order,
    });
  } catch (error: any) {
    console.error('[qstash/zoho/orders/ingest]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 },
    );
  }
}

export const POST = verifySignatureAppRouter(handleZohoOrderIngest);

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'zoho-order-ingest' });
}
