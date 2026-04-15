import { NextRequest, NextResponse } from 'next/server';
import { searchPurchaseOrdersByTracking } from '@/lib/zoho';

// Tracking-only PO lookup. Read-only: no local writes, no side effects.
// PO#-based search is deferred to a future update.
//
// Input:  { trackingNumber: string }
// Output:
//   { success, matched, purchase_order: {...} | null, candidates: [...] }
//
// When multiple POs match the same reference/search, `purchase_order` is the
// first hit and `candidates` carries the full list so the caller can disambiguate.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const trackingNumber = String(body?.trackingNumber || body?.tracking_number || '').trim();

    if (!trackingNumber) {
      return NextResponse.json(
        { success: false, error: 'trackingNumber is required' },
        { status: 400 },
      );
    }

    const purchaseOrders = await searchPurchaseOrdersByTracking(trackingNumber);
    const first = purchaseOrders[0] ?? null;

    return NextResponse.json({
      success: true,
      matched: purchaseOrders.length > 0,
      purchase_order: first
        ? {
            zoho_purchaseorder_id: first.purchaseorder_id,
            zoho_purchaseorder_number: first.purchaseorder_number ?? null,
            reference_number: first.reference_number ?? null,
            vendor_name: first.vendor_name ?? null,
            line_count: Array.isArray(first.line_items) ? first.line_items.length : 0,
          }
        : null,
      candidates: purchaseOrders.map((po) => ({
        zoho_purchaseorder_id: po.purchaseorder_id,
        zoho_purchaseorder_number: po.purchaseorder_number ?? null,
        reference_number: po.reference_number ?? null,
        vendor_name: po.vendor_name ?? null,
      })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'find-po failed';
    console.error('zoho/find-po POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
