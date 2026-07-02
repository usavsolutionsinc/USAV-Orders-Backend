import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { ApiError, errorResponse } from '@/lib/api';
import type { OrgId } from '@/lib/tenancy/constants';
import { tenantQuery } from '@/lib/tenancy/db';
import {
  getShipStationV1,
  getShipStationV2,
  resolveShipFrom,
  ShipFromNotConfiguredError,
  ShipStationNotConnectedError,
} from '@/lib/shipping/shipstation/config';
import { ShipStationApiError } from '@/lib/shipping/shipstation/client';
import type { Parcel, ShipAddress, ShipmentSpec } from '@/lib/shipping/shipstation/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/outbound/rates
 *
 * Rate-shop a single order via the ShipStation v2 engine. Ship-to + parcel
 * weight come from the order's stored ShipStation data when it's ShipStation-
 * sourced (the user's chosen weight source, fetched live from v1); otherwise
 * from the local customer + an explicit weight override. Read-only — no DB
 * mutation, no label purchased.
 *
 * Body: { orderId: number, carrierIds?: string[], weightOz?: number }
 * Returns the normalized RateQuoteResult (see src/lib/shipping/shipstation/types).
 */

// `type` (not `interface`) so it satisfies pg/tenantQuery's `QueryResultRow`
// constraint — interfaces lack the implicit index signature.
type OrderRow = {
  id: number;
  order_id: string | null;
  account_source: string | null;
  customer_id: number | null;
};

async function loadOrder(orgId: OrgId, orderId: number): Promise<OrderRow | null> {
  const res = await tenantQuery<OrderRow>(
    orgId,
    `SELECT id, order_id, account_source, customer_id
       FROM orders WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [orderId, orgId],
  );
  return res.rows[0] ?? null;
}

async function loadCustomerShipTo(orgId: OrgId, customerId: number): Promise<ShipAddress | null> {
  const res = await tenantQuery<{
    name: string | null;
    phone: string | null;
    addr1: string | null;
    addr2: string | null;
    city: string | null;
    state: string | null;
    postal: string | null;
    country: string | null;
  }>(
    orgId,
    `SELECT
       COALESCE(NULLIF(display_name, ''), NULLIF(customer_name, ''),
                NULLIF(CONCAT_WS(' ', NULLIF(first_name, ''), NULLIF(last_name, '')), ''), '') AS name,
       NULLIF(phone, '')              AS phone,
       NULLIF(shipping_address_1, '') AS addr1,
       NULLIF(shipping_address_2, '') AS addr2,
       NULLIF(shipping_city, '')      AS city,
       NULLIF(shipping_state, '')     AS state,
       NULLIF(shipping_postal_code, '') AS postal,
       NULLIF(shipping_country, '')   AS country
     FROM customers WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [customerId, orgId],
  );
  const r = res.rows[0];
  if (!r || !r.addr1 || !r.city) return null;
  return {
    name: r.name || 'Customer',
    phone: r.phone,
    company: null,
    addressLine1: r.addr1,
    addressLine2: r.addr2,
    cityLocality: r.city,
    stateProvince: r.state ?? '',
    postalCode: r.postal ?? '',
    countryCode: (r.country ?? 'US').toUpperCase(),
    residential: true,
  };
}

/** Resolve ship-to + parcel weight, preferring ShipStation-stored data. */
async function resolveShipToAndWeight(
  orgId: OrgId,
  order: OrderRow,
  weightOzOverride: number | null,
): Promise<{ shipTo: ShipAddress | null; weight: Parcel['weight'] | null }> {
  let shipTo: ShipAddress | null = null;
  let weight: Parcel['weight'] | null = null;

  if (order.account_source === 'shipstation' && order.order_id) {
    const v1 = await getShipStationV1(orgId);
    if (v1) {
      const ssOrder = await v1.getOrderByNumber(order.order_id);
      if (ssOrder) {
        shipTo = ssOrder.shipTo;
        if (ssOrder.weight) weight = ssOrder.weight;
      }
    }
  }

  if (!shipTo && order.customer_id) {
    shipTo = await loadCustomerShipTo(orgId, order.customer_id);
  }
  // An explicit override always wins (missing-weight fallback).
  if (weightOzOverride) weight = { value: weightOzOverride, unit: 'ounce' };

  return { shipTo, weight };
}

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId as OrgId;
    const body = await req.json().catch(() => null);
    const orderId = Number(body?.orderId);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      throw ApiError.badRequest('Valid orderId is required');
    }
    const carrierIds = Array.isArray(body?.carrierIds)
      ? body.carrierIds.filter((x: unknown): x is string => typeof x === 'string')
      : undefined;
    const weightOzOverride =
      typeof body?.weightOz === 'number' && body.weightOz > 0 ? body.weightOz : null;

    const order = await loadOrder(orgId, orderId);
    if (!order) throw ApiError.notFound('order', orderId);

    const { shipTo, weight } = await resolveShipToAndWeight(orgId, order, weightOzOverride);
    if (!shipTo) {
      throw ApiError.badRequest(
        'No ship-to address on this order. Add a customer shipping address (or sync it from ShipStation).',
      );
    }
    if (!weight) {
      throw ApiError.badRequest(
        'No parcel weight available. Provide weightOz, or ensure the ShipStation order carries a weight.',
      );
    }

    const shipFrom = await resolveShipFrom(orgId);
    const spec: ShipmentSpec = {
      shipTo,
      shipFrom,
      parcels: [{ weight }],
      carrierIds: carrierIds && carrierIds.length ? carrierIds : undefined,
    };

    const client = await getShipStationV2(orgId);
    const result = await client.getRates(spec);

    return NextResponse.json({ ok: true, ...result, shipTo, weight });
  } catch (error) {
    if (error instanceof ShipStationNotConnectedError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: 'SHIPSTATION_NOT_CONNECTED' },
        { status: 400 },
      );
    }
    if (error instanceof ShipFromNotConfiguredError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: 'SHIP_FROM_NOT_CONFIGURED' },
        { status: 400 },
      );
    }
    if (error instanceof ShipStationApiError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.isNotConnected ? 400 : 502 },
      );
    }
    return errorResponse(error, 'POST /api/outbound/rates');
  }
}, { permission: 'shipping.buy_label' });
