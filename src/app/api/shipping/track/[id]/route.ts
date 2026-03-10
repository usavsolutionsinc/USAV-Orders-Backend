import { NextRequest, NextResponse } from 'next/server';
import { getShipmentById, getShipmentEvents } from '@/lib/shipping/repository';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!id || isNaN(id)) {
    return NextResponse.json({ error: 'Invalid shipment id' }, { status: 400 });
  }

  const [shipment, events] = await Promise.all([
    getShipmentById(id),
    getShipmentEvents(id),
  ]);

  if (!shipment) {
    return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
  }

  return NextResponse.json({ shipment, events });
}
