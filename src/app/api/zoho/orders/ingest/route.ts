import { NextRequest, NextResponse } from 'next/server';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';
import { enqueueQStashJson, getQStashResultIdentifier } from '@/lib/qstash';
import { orderSyncService, type ChannelOrder } from '@/services/OrderSyncService';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!isAllowedAdminOrigin(request)) {
    return NextResponse.json({ success: false, error: 'Origin not allowed' }, { status: 403 });
  }

  try {
    const body = (await request.json()) as Partial<ChannelOrder> & { enqueue?: boolean };
    const shouldEnqueue = body.enqueue === true || request.nextUrl.searchParams.get('enqueue') === 'true';

    if (shouldEnqueue) {
      const result = await enqueueQStashJson({
        path: '/api/qstash/zoho/orders/ingest',
        body: { ...body, enqueue: false },
        retries: 3,
        timeout: 300,
        deduplicationId: body.channelOrderId ? `zoho-order-ingest:${body.channelOrderId}` : undefined,
        label: 'zoho-order-ingest',
      });
      return NextResponse.json({
        success: true,
        queued: true,
        messageId: getQStashResultIdentifier(result),
      });
    }

    const order = await orderSyncService.ingestExternalOrder(body as ChannelOrder);
    return NextResponse.json({ success: true, order });
  } catch (error: any) {
    console.error('[zoho/orders/ingest]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to ingest external order into Zoho' },
      { status: 500 }
    );
  }
}
