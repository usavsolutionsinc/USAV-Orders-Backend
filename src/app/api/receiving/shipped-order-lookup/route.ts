import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { lookupShippedOrderForCompare } from '@/lib/receiving/returned-serial-link';

/**
 * GET /api/receiving/shipped-order-lookup?order_number=<n>&received_serial=<s>
 *
 * READ-ONLY. Resolve a shipped sales order by its ORDER NUMBER and compare the
 * serial(s) we shipped on it against a received serial (the unit in hand).
 *
 * Powers the "Order #" search lane in the Unfound-carton Auto-match row: instead
 * of a hard wall when a scanned serial has no shipped match, the operator types
 * the order number off the return label to confirm the physical unit matches
 * what we shipped, then links it (import-sales-order) or files a ticket. This
 * endpoint only reads — no mutation, no allocation flip, no promote, no audit.
 */
export const GET = withAuth(async (request: NextRequest, ctx) => {
  const orderNumber = (request.nextUrl.searchParams.get('order_number') ?? '').trim();
  const receivedSerial =
    (request.nextUrl.searchParams.get('received_serial') ?? '').trim() || null;

  if (!orderNumber) {
    return NextResponse.json(
      { success: false, error: 'order_number is required' },
      { status: 400 },
    );
  }

  try {
    const result = await lookupShippedOrderForCompare(
      { orderNumber, receivedSerial },
      ctx.organizationId,
    );
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to look up shipped order';
    console.error('receiving/shipped-order-lookup GET failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, { permission: 'receiving.scan_po' });
