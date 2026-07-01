import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { listDocumentsForShipment } from '@/lib/documents/outbound-documents';
import type { OrgId } from '@/lib/tenancy/constants';

/**
 * Per-STN outbound documents — the multi-box view (docs/outbound-documents-plan.md
 * §8.2). `id` here is `shipping_tracking_numbers.id`, not an order id.
 */

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRoutePerm(req, 'shipping.view');
  if (gate.denied) return gate.denied;

  const { id: rawId } = await params;
  const shipmentId = parseId(rawId);
  if (shipmentId === null) {
    return NextResponse.json({ error: 'Invalid shipment id' }, { status: 400 });
  }

  try {
    const documents = await listDocumentsForShipment(gate.ctx.organizationId as OrgId, shipmentId);
    return NextResponse.json({ success: true, documents });
  } catch (error) {
    console.error('Error in GET /api/shipments/[id]/documents:', error);
    return NextResponse.json({ error: 'Failed to load documents' }, { status: 500 });
  }
}
