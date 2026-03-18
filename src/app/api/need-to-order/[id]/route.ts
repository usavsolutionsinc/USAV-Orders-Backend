import { NextRequest, NextResponse } from 'next/server';
import { cancelNeedToOrderRequest, updateNeedToOrderRequest } from '@/lib/replenishment';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json();

    await updateNeedToOrderRequest(
      id,
      {
        quantity_needed: body?.quantity_needed,
        status: body?.status,
        notes: body?.notes,
        vendor_zoho_contact_id: body?.vendor_zoho_contact_id,
        vendor_name: body?.vendor_name,
        unit_cost: body?.unit_cost,
      },
      'staff'
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    const status = String(error?.message || '').includes('Not found') ? 404 : 500;
    return NextResponse.json(
      { error: 'Failed to update need-to-order request', details: error?.message || String(error) },
      { status }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await cancelNeedToOrderRequest(id, 'staff');
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to cancel need-to-order request', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
