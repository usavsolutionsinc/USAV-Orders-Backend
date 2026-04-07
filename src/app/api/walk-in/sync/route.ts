import { NextRequest, NextResponse } from 'next/server';
import { getSquareConfig, squareFetch, formatSquareErrors } from '@/lib/square/client';
import { insertSquareTransaction } from '@/lib/neon/square-transaction-queries';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';
import { isRepairSku } from '@/utils/sku';

/**
 * POST /api/walk-in/sync
 * Backfill completed Square orders into square_transactions table.
 */
export async function POST(req: NextRequest) {
  try {
    if (!isAllowedAdminOrigin(req)) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }

    const cfg = getSquareConfig();

    // Fetch last 50 completed orders
    const result = await squareFetch<{ orders?: Array<Record<string, unknown>> }>(
      '/orders/search',
      {
        method: 'POST',
        body: {
          location_ids: [cfg.locationId],
          limit: 50,
          query: {
            sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' },
            filter: { state_filter: { states: ['COMPLETED'] } },
          },
        },
        config: cfg,
      },
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: formatSquareErrors(result.errors) },
        { status: 502 },
      );
    }

    const orders = result.data.orders || [];
    let synced = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const order of orders) {
      const o = order as any;
      const orderId = o.id;
      if (!orderId) { skipped++; continue; }

      const lineItems = (o.line_items || []).map((li: any) => ({
        name: li.name || li.catalog_object_id || 'Item',
        sku: li.catalog_object_id || null,
        quantity: li.quantity || '1',
        price: li.total_money?.amount || li.base_price_money?.amount || 0,
      }));

      // Determine source from SKU convention
      const hasRepairSku = lineItems.some((li: any) => isRepairSku(li.sku));

      // Try to get payment info
      const tenders = o.tenders || [];
      const firstTender = tenders[0] as any;

      try {
        await insertSquareTransaction({
          square_order_id: orderId,
          square_payment_id: firstTender?.id || null,
          square_customer_id: o.customer_id || null,
          customer_name: null,
          customer_email: null,
          customer_phone: null,
          line_items: lineItems,
          subtotal: o.total_money?.amount
            ? (o.total_money.amount - (o.total_tax_money?.amount || 0) - (o.total_tip_money?.amount || 0))
            : null,
          tax: o.total_tax_money?.amount || 0,
          total: o.total_money?.amount || 0,
          discount: o.total_discount_money?.amount || 0,
          status: 'completed',
          payment_method: firstTender?.type || 'CARD',
          receipt_url: firstTender?.payment_id
            ? `https://squareup.com/receipt/preview/${firstTender.payment_id}`
            : null,
          order_source: hasRepairSku ? 'repair_payment' : 'walk_in_sale',
          notes: o.source?.name || null,
          created_at: o.created_at || null,
        });
        synced++;
      } catch (err: any) {
        // ON CONFLICT will update existing — count as synced
        if (err?.message?.includes('duplicate') || err?.code === '23505') {
          skipped++;
        } else {
          errors.push(`${orderId}: ${err?.message || 'Unknown error'}`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      total_orders: orders.length,
      synced,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: unknown) {
    console.error('POST /api/walk-in/sync error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
