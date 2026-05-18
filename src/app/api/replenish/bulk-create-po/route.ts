import { NextRequest, NextResponse } from 'next/server';
import { createDraftPurchaseOrders } from '@/lib/replenishment';
import { withAuth } from '@/lib/auth/withAuth';

// Creates draft Zoho POs from staged replenishment requests. Approval-level
// action — wired to replenish.approve_po which is in STEP_UP_PERMISSIONS so
// the wrapper also requires a fresh step-up grant.
export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const ids = body.replenishment_request_ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: 'replenishment_request_ids must be a non-empty array' },
        { status: 400 }
      );
    }

    if (ids.length > 50) {
      return NextResponse.json(
        { error: 'Maximum 50 requests per batch' },
        { status: 400 }
      );
    }

    const created = await createDraftPurchaseOrders(ids);

    return NextResponse.json({
      success: true,
      purchase_orders: created,
      count: created.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to create purchase orders', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}, { permission: 'replenish.approve_po' });
