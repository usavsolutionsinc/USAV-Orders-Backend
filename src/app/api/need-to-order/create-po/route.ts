import { NextRequest, NextResponse } from 'next/server';
import { requireInternalToken } from '@/lib/internal-api';
import { createDraftPurchaseOrders } from '@/lib/replenishment';

export async function POST(req: NextRequest) {
  const authError = requireInternalToken(req);
  if (authError) return authError;

  try {
    const body = await req.json();
    const replenishmentIds = Array.isArray(body?.replenishment_ids) ? body.replenishment_ids.map(String) : [];
    if (replenishmentIds.length === 0) {
      return NextResponse.json({ error: 'replenishment_ids is required' }, { status: 400 });
    }

    const created = await createDraftPurchaseOrders(replenishmentIds);
    return NextResponse.json({ success: true, created_pos: created });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to create Zoho purchase order', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
