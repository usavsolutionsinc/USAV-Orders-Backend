import { NextRequest, NextResponse } from 'next/server';
import { cancelNeedToOrderRequest, updateNeedToOrderRequest } from '@/lib/replenishment';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireRoutePerm(req, 'replenish.create_po');
    if (gate.denied) return gate.denied;
    const { id } = await context.params;
    const body = await req.json();

    // Tenant isolation: thread the caller's org so updateNeedToOrderRequest
    // does its existence-check + UPDATE under `WHERE id=$1 AND organization_id=$2`.
    // A request owned by another tenant yields no row → throws 'Not found' →
    // mapped to a 404 below (org-ownership 404, never 403).
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
      'staff',
      gate.ctx.organizationId
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
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireRoutePerm(req, 'replenish.create_po');
    if (gate.denied) return gate.denied;
    const { id } = await context.params;
    // Tenant isolation: thread the caller's org so the cancel transition
    // selects/UPDATEs replenishment_requests under `id=$1 AND organization_id=$2`
    // and stamps replenishment_status_log.organization_id (parent-derived).
    // A request owned by another tenant yields no row → throws 'not found' →
    // mapped to a 404 below (org-ownership 404, never 403).
    await cancelNeedToOrderRequest(id, 'staff', gate.ctx.organizationId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const status = /not found/i.test(String(error?.message || '')) ? 404 : 500;
    return NextResponse.json(
      { error: 'Failed to cancel need-to-order request', details: error?.message || String(error) },
      { status }
    );
  }
}
