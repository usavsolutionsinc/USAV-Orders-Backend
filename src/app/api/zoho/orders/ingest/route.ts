import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';
import { orderSyncService, type ChannelOrder } from '@/services/OrderSyncService';
import { withAuth } from '@/lib/auth/withAuth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const POST = withAuth(async (request: NextRequest, ctx) => {
  if (!isAllowedAdminOrigin(request)) {
    return NextResponse.json({ success: false, error: 'Origin not allowed' }, { status: 403 });
  }

  try {
    const body = (await request.json()) as Partial<ChannelOrder> & { enqueue?: boolean };
    const shouldEnqueue = body.enqueue === true || request.nextUrl.searchParams.get('enqueue') === 'true';

    if (shouldEnqueue) {
      // DB-backed queue (outbox) — replaces the QStash event queue. The drain
      // cron (/api/cron/zoho/orders-ingest-drain) processes pending rows every
      // minute. UNIQUE(channel_order_id) dedups bursts; a row that already
      // finished is re-queued with the fresh payload, an in-flight one is left
      // alone (the ON CONFLICT WHERE).
      if (!body.channelOrderId) {
        return NextResponse.json(
          { success: false, error: 'channelOrderId is required to enqueue' },
          { status: 400 },
        );
      }
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO order_ingest_queue (channel_order_id, organization_id, payload, status)
         VALUES ($1, $2, $3, 'pending')
         ON CONFLICT (channel_order_id) DO UPDATE
           SET payload = EXCLUDED.payload,
               organization_id = EXCLUDED.organization_id,
               status = 'pending',
               attempts = 0,
               last_error = NULL,
               processed_at = NULL
         WHERE order_ingest_queue.status IN ('done', 'failed')
         RETURNING id`,
        [body.channelOrderId, ctx.organizationId, JSON.stringify({ ...body, enqueue: false })],
      );
      return NextResponse.json({ success: true, queued: true, queueId: rows[0]?.id ?? null });
    }

    const order = await orderSyncService.ingestExternalOrder(ctx.organizationId, body as ChannelOrder);
    return NextResponse.json({ success: true, order });
  } catch (error: any) {
    console.error('[zoho/orders/ingest]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to ingest external order into Zoho' },
      { status: 500 }
    );
  }
}, { permission: 'integrations.zoho' });
