import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/api-guard';
import { registerShipment } from '@/lib/shipping/sync-shipment';
import type { CarrierCode } from '@/lib/shipping/types';

export async function POST(req: NextRequest) {
  const rate = checkRateLimit({
    headers: req.headers,
    routeKey: 'shipping-register',
    limit: 60,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: rate.retryAfterSec ? { 'Retry-After': String(rate.retryAfterSec) } : undefined }
    );
  }

  let body: { trackingNumber?: string; carrier?: string; sourceSystem?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const trackingNumber = String(body.trackingNumber ?? '').trim();
  if (!trackingNumber) {
    return NextResponse.json({ error: 'trackingNumber is required' }, { status: 400 });
  }

  const carrierInput = body.carrier ? String(body.carrier).toUpperCase() : undefined;
  const validCarriers: CarrierCode[] = ['UPS', 'USPS', 'FEDEX'];
  const carrier = carrierInput && validCarriers.includes(carrierInput as CarrierCode)
    ? (carrierInput as CarrierCode)
    : undefined;

  try {
    const shipment = await registerShipment({
      trackingNumber,
      carrier,
      sourceSystem: body.sourceSystem,
    });

    return NextResponse.json({ ok: true, shipment }, { status: 201 });
  } catch (err: any) {
    const message = err?.message ?? 'Registration failed';
    if (message.includes('Cannot detect carrier')) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    console.error('[shipping/register]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
