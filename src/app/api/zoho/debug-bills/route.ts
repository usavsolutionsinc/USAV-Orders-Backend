import { NextRequest, NextResponse } from 'next/server';
import { listBillsForPurchaseOrder, getPurchaseOrderById } from '@/lib/zoho';
import { withAuth } from '@/lib/auth/withAuth';
import { withZohoOrg } from '@/lib/zoho/tenant-context';
import { zohoGet } from '@/lib/zoho/httpClient';

export const dynamic = 'force-dynamic';

/**
 * Debug-only: returns the bills the /bills endpoint surfaces for a given PO,
 * plus the `bills[]` (if any) the PO detail returns. Lets us confirm whether
 * the billed-PO receive payload can resolve a bill_id.
 *
 * GET /api/zoho/debug-bills?purchaseorder_id=...
 */
export const GET = withAuth(async (request: NextRequest, ctx) => {
  const purchaseorderId = (request.nextUrl.searchParams.get('purchaseorder_id') || '').trim();
  if (!purchaseorderId) {
    return NextResponse.json({ ok: false, error: 'purchaseorder_id required' }, { status: 400 });
  }

  const billIdParam = (request.nextUrl.searchParams.get('bill_id') || '').trim();

  // Bind the authenticated tenant so the Zoho client resolves THIS org's creds.
  const [billsResult, poResult, billDetailResult] = await withZohoOrg(ctx.organizationId, () =>
    Promise.allSettled([
      listBillsForPurchaseOrder(purchaseorderId),
      getPurchaseOrderById(purchaseorderId),
      billIdParam
        ? zohoGet<{ bill?: Record<string, unknown> }>(`/api/v1/bills/${billIdParam}`)
        : Promise.resolve(null),
    ]),
  );

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
    bill_detail:
      billDetailResult.status === 'fulfilled'
        ? billDetailResult.value
        : { error: String((billDetailResult as PromiseRejectedResult).reason) },
  });
}, { permission: 'integrations.zoho' });
