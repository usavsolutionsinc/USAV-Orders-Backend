import { NextRequest, NextResponse } from 'next/server';
import { listBillsForPurchaseOrder, getPurchaseOrderById } from '@/lib/zoho';

export const dynamic = 'force-dynamic';

/**
 * Debug-only: returns the bills the /bills endpoint surfaces for a given PO,
 * plus the `bills[]` (if any) the PO detail returns. Lets us confirm whether
 * the billed-PO receive payload can resolve a bill_id.
 *
 * GET /api/zoho/debug-bills?purchaseorder_id=...
 */
export async function GET(request: NextRequest) {
  const purchaseorderId = (request.nextUrl.searchParams.get('purchaseorder_id') || '').trim();
  if (!purchaseorderId) {
    return NextResponse.json({ ok: false, error: 'purchaseorder_id required' }, { status: 400 });
  }

  const [billsResult, poResult] = await Promise.allSettled([
    listBillsForPurchaseOrder(purchaseorderId),
    getPurchaseOrderById(purchaseorderId),
  ]);

  return NextResponse.json({
    ok: true,
    purchaseorder_id: purchaseorderId,
    bills_from_endpoint:
      billsResult.status === 'fulfilled'
        ? billsResult.value
        : { error: String((billsResult as PromiseRejectedResult).reason) },
    bills_from_po_detail:
      poResult.status === 'fulfilled'
        ? (poResult.value?.purchaseorder as { bills?: unknown })?.bills ?? null
        : { error: String((poResult as PromiseRejectedResult).reason) },
    po_status:
      poResult.status === 'fulfilled'
        ? {
            status: (poResult.value?.purchaseorder as { status?: string })?.status,
            received_status: (poResult.value?.purchaseorder as { received_status?: string })
              ?.received_status,
          }
        : null,
  });
}
