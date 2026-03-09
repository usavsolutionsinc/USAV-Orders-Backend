import { NextRequest, NextResponse } from 'next/server';
import { importZohoPurchaseReceiveToReceiving } from '@/lib/zoho-receiving-sync';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const purchaseReceiveId = String(body?.purchase_receive_id || '').trim();
    const receivedByRaw = Number(body?.received_by);
    const receivedBy = Number.isFinite(receivedByRaw) && receivedByRaw > 0 ? receivedByRaw : null;
    const assignedTechIdRaw = Number(body?.assigned_tech_id);
    const assignedTechId = Number.isFinite(assignedTechIdRaw) && assignedTechIdRaw > 0 ? assignedTechIdRaw : null;
    const needsTest = !!body?.needs_test;
    const targetChannel = String(body?.target_channel || '').trim().toUpperCase();

    if (!purchaseReceiveId) {
      return NextResponse.json({ success: false, error: 'purchase_receive_id is required' }, { status: 400 });
    }

    const result = await importZohoPurchaseReceiveToReceiving({
      purchaseReceiveId,
      receivedBy,
      assignedTechId,
      needsTest,
      targetChannel,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('Zoho purchase receive import failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to import Zoho purchase receive',
      },
      { status: 500 }
    );
  }
}
