import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSquareConfig, squareFetch, formatSquareErrors } from '@/lib/square/client';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';

interface LineItemInput {
  catalog_object_id: string;
  quantity: string; // Square requires string
}

interface CreateOrderBody {
  line_items: LineItemInput[];
  customer_id?: string;
}

/**
 * POST /api/walk-in/orders
 * Create a Square order for walk-in sale.
 */
export async function POST(req: NextRequest) {
  try {
    if (!isAllowedAdminOrigin(req)) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as CreateOrderBody;

    if (!Array.isArray(body.line_items) || body.line_items.length === 0) {
      return NextResponse.json({ error: 'line_items is required' }, { status: 400 });
    }

    const cfg = getSquareConfig();

    const orderBody: Record<string, unknown> = {
      idempotency_key: randomUUID(),
      order: {
        location_id: cfg.locationId,
        line_items: body.line_items.map((li) => ({
          catalog_object_id: li.catalog_object_id,
          quantity: String(li.quantity || '1'),
        })),
        ...(body.customer_id ? { customer_id: body.customer_id } : {}),
      },
    };

    const result = await squareFetch<{ order?: Record<string, unknown> }>(
      '/orders',
      { method: 'POST', body: orderBody, config: cfg },
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: formatSquareErrors(result.errors) },
        { status: 502 },
      );
    }

    return NextResponse.json({ order: result.data.order });
  } catch (error: unknown) {
    console.error('POST /api/walk-in/orders error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
