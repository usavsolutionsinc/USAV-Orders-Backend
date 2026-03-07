import { NextRequest, NextResponse } from 'next/server';
import { listPurchaseOrders, getPurchaseOrderById } from '@/lib/zoho';

export const dynamic = 'force-dynamic';

/**
 * GET /api/zoho/purchase-orders
 *
 * Supports:
 *  ?purchaseorder_id=  → single PO detail (includes line_items)
 *  ?status=open        → filter by status (draft|open|billed|cancelled)
 *  ?search_text=       → search by PO number, vendor name, reference
 *  ?page=&per_page=    → pagination (max 200)
 *  ?last_modified_time= → ISO date filter for incremental sync
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const purchaseOrderId = (searchParams.get('purchaseorder_id') ?? '').trim();

    if (purchaseOrderId) {
      const data = await getPurchaseOrderById(purchaseOrderId);
      return NextResponse.json({ success: true, mode: 'detail', ...data });
    }

    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const perPage = Math.min(200, Math.max(1, Number(searchParams.get('per_page') || 50)));
    const status = (searchParams.get('status') ?? '').trim() || undefined;
    const searchText = (searchParams.get('search_text') ?? '').trim() || undefined;
    const vendorId = (searchParams.get('vendor_id') ?? '').trim() || undefined;
    const lastModifiedTime = (searchParams.get('last_modified_time') ?? '').trim() || undefined;

    const data = await listPurchaseOrders({
      page,
      per_page: perPage,
      status,
      search_text: searchText,
      vendor_id: vendorId,
      last_modified_time: lastModifiedTime,
    });

    return NextResponse.json({ success: true, mode: 'list', ...data });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch purchase orders';
    console.error('Zoho purchase orders API failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
