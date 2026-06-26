import { NextRequest, NextResponse } from 'next/server';
import { getShipmentById, getShipmentEvents } from '@/lib/shipping/repository';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Previously this route had NO auth and called the repo without an orgId,
  // so any caller could enumerate sequential ids and read every tenant's
  // shipments. Require a valid session + shipping.view, and thread the
  // session org so the read is GUC-scoped (a hard org predicate lands once
  // shipping_tracking_numbers/shipment_tracking_events carry organization_id —
  // see the NEEDS-COL notes in the repository).
  const gate = await requireRoutePerm(req, 'shipping.view');
  if (gate.denied) return gate.denied;
  const orgId = gate.ctx.organizationId ?? undefined;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!id || isNaN(id)) {
    return NextResponse.json({ error: 'Invalid shipment id' }, { status: 400 });
  }

  const [shipment, events] = await Promise.all([
    getShipmentById(id, orgId),
    getShipmentEvents(id, orgId),
  ]);

  if (!shipment) {
    return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
  }

  return NextResponse.json({ shipment, events });
}
