import { createHmac } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { squareFetch } from '@/lib/square/client';
import { insertSquareTransaction } from '@/lib/neon/square-transaction-queries';
import { publishSaleCompleted } from '@/lib/realtime/walkin-events';
import { isRepairSku } from '@/utils/sku';

const WEBHOOK_SIGNATURE_KEY = () =>
  (process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '').trim();

const WEBHOOK_NOTIFICATION_URL = () =>
  (process.env.SQUARE_WEBHOOK_NOTIFICATION_URL || '').trim();

function verifySquareSignature(
  body: string,
  signature: string,
  notificationUrl: string,
): boolean {
  const key = WEBHOOK_SIGNATURE_KEY();
  if (!key) {
    console.warn('SQUARE_WEBHOOK_SIGNATURE_KEY not set — skipping verification');
    return true; // Allow in dev
  }

  const combined = notificationUrl + body;
  const expectedSignature = createHmac('sha256', key)
    .update(combined)
    .digest('base64');

  return signature === expectedSignature;
}

interface SquareWebhookEvent {
  type: string;
  data?: {
    type?: string;
    id?: string;
    object?: {
      payment?: {
        id?: string;
        order_id?: string;
        receipt_url?: string;
        source_type?: string;
        total_money?: { amount?: number; currency?: string };
        customer_id?: string;
      };
    };
  };
}

/**
 * POST /api/webhooks/square
 * Receives Square webhook events (e.g. payment.completed).
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-square-hmacsha256-signature') || '';
    const notificationUrl = WEBHOOK_NOTIFICATION_URL() || req.url;

    if (!verifySquareSignature(rawBody, signature, notificationUrl)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const event: SquareWebhookEvent = JSON.parse(rawBody);

    if (event.type === 'payment.completed') {
      const payment = event.data?.object?.payment;
      if (!payment?.order_id) {
        return NextResponse.json({ received: true });
      }

      // Fetch the full order to get line items
      const orderResult = await squareFetch<{ order?: Record<string, unknown> }>(
        `/orders/${payment.order_id}`,
      );

      const order = orderResult.data?.order as any;
      const lineItems = (order?.line_items || []).map((li: any) => ({
        name: li.name || li.catalog_object_id || 'Item',
        sku: li.catalog_object_id || null,
        quantity: li.quantity || '1',
        price: li.total_money?.amount || 0,
      }));

      // Determine order source from SKU convention
      const hasRepairSku = lineItems.some((li: any) => isRepairSku(li.sku));
      const orderSource = hasRepairSku ? 'repair_payment' : 'walk_in_sale';

      await insertSquareTransaction({
        square_order_id: payment.order_id,
        square_payment_id: payment.id || null,
        square_customer_id: payment.customer_id || order?.customer_id || null,
        customer_name: null, // Populated from customer lookup if needed
        customer_email: null,
        customer_phone: null,
        line_items: lineItems,
        subtotal: order?.total_money?.amount
          ? (order.total_money.amount - (order.total_tax_money?.amount || 0))
          : null,
        tax: order?.total_tax_money?.amount || null,
        total: order?.total_money?.amount || payment.total_money?.amount || null,
        discount: order?.total_discount_money?.amount || 0,
        status: 'completed',
        payment_method: payment.source_type || 'CARD',
        receipt_url: payment.receipt_url || null,
        order_source: orderSource,
      });

      await publishSaleCompleted({
        squareOrderId: payment.order_id,
        source: 'square-webhook',
      }).catch((err) => console.error('Failed to publish sale event:', err));
    }

    return NextResponse.json({ received: true });
  } catch (error: unknown) {
    console.error('POST /api/webhooks/square error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/webhooks/square — health check for Square webhook config.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    callbackPath: '/api/webhooks/square',
    signatureKeyConfigured: !!WEBHOOK_SIGNATURE_KEY(),
  });
}
