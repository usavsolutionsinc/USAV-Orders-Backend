import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSquareConfig, squareFetch, formatSquareErrors } from '@/lib/square/client';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';
import { withAuth } from '@/lib/auth/withAuth';

interface LineItemInput {
  /** Square catalog variation id — present for catalog products. */
  catalog_object_id?: string;
  /** Ad-hoc line name — present for manual "not in catalog" products. */
  name?: string;
  /** Ad-hoc unit price in minor units; currency defaults to the location's. */
  base_price_money?: { amount: number; currency?: string };
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
export const POST = withAuth(async (req: NextRequest) => {
  try {
    if (!isAllowedAdminOrigin(req)) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as CreateOrderBody;

    if (!Array.isArray(body.line_items) || body.line_items.length === 0) {
      return NextResponse.json({ error: 'line_items is required' }, { status: 400 });
    }

    const cfg = getSquareConfig();

    // Catalog lines charge by catalog_object_id (Square's price is
    // authoritative); manual lines come through as ad-hoc name + base_price_money
    // (the "Product not added yet?" path), so the terminal can still charge them.
    const orderBody: Record<string, unknown> = {
      idempotency_key: randomUUID(),
      order: {
        location_id: cfg.locationId,
        line_items: body.line_items.map((li) => {
          const quantity = String(li.quantity || '1');
          if (li.catalog_object_id) {
            return { catalog_object_id: li.catalog_object_id, quantity };
          }
          return {
            name: li.name || 'Item',
            quantity,
            base_price_money: {
              amount: Math.max(0, Math.round(li.base_price_money?.amount ?? 0)),
              currency: li.base_price_money?.currency || cfg.currency,
            },
          };
        }),
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
}, { permission: 'walk_in.intake' });
