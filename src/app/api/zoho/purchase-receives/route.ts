import { NextRequest, NextResponse } from 'next/server';
import { getPurchaseReceiveById, listPurchaseReceives, searchPurchaseReceivesByTracking } from '@/lib/zoho';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const purchaseReceiveId = String(searchParams.get('purchase_receive_id') || '').trim();
    const tracking = String(searchParams.get('tracking') || '').trim();
    const page = Number(searchParams.get('page') || 1);
    const perPage = Number(searchParams.get('per_page') || 50);
    const lastModifiedTime = String(searchParams.get('last_modified_time') || '').trim();
    const purchaseOrderId = String(searchParams.get('purchaseorder_id') || '').trim();

    if (purchaseReceiveId) {
      const data = await getPurchaseReceiveById(purchaseReceiveId);
      return NextResponse.json({
        success: true,
        mode: 'detail',
        ...data,
      });
    }

    // Tracking-based lookup: used by Mode 1 background Zoho enrichment
    if (tracking) {
      const receives = await searchPurchaseReceivesByTracking(tracking);
      return NextResponse.json({
        success: true,
        mode: 'tracking-search',
        purchasereceives: receives,
        found: receives.length > 0,
      });
    }

    const data = await listPurchaseReceives({
      page: Number.isFinite(page) && page > 0 ? page : 1,
      per_page: Number.isFinite(perPage) && perPage > 0 ? Math.min(perPage, 200) : 50,
      last_modified_time: lastModifiedTime || undefined,
      purchaseorder_id: purchaseOrderId || undefined,
    });

    return NextResponse.json({
      success: true,
      mode: 'list',
      ...data,
    });
  } catch (error: any) {
    console.error('Zoho purchase receives API failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to fetch Zoho purchase receives',
      },
      { status: 500 }
    );
  }
}
