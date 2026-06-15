import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import {
  createAuthorization,
  listOpen,
  type RmaDirection,
} from '@/lib/rma/authorizations';

const VALID_DIRECTIONS: ReadonlySet<RmaDirection> = new Set([
  'INBOUND_FROM_CUSTOMER',
  'OUTBOUND_TO_VENDOR',
]);

/**
 * GET /api/rma
 *
 * Lists open RMAs (AUTHORIZED / RECEIVED / DISPOSITIONED), newest first.
 */
export const GET = withAuth(async (_request, ctx) => {
  try {
    const rmas = await listOpen(ctx.organizationId);
    return NextResponse.json({ ok: true, rmas });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'list rma failed';
    console.error('[GET /api/rma] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'orders.view' });

/**
 * POST /api/rma
 *
 * Issues a new RMA. Generates the RMA-YYYY-NNNNN number server-side.
 *
 * Body: {
 *   direction: 'INBOUND_FROM_CUSTOMER' | 'OUTBOUND_TO_VENDOR',
 *   order_id?: number, customer_id?: number,
 *   expires_at?: ISO timestamp, expected_carrier?: string,
 *   notes?: string
 * }
 */
export const POST = withAuth(async (request, ctx) => {
  const orgId = ctx.organizationId;
  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;
  if (actorStaffId == null) {
    return NextResponse.json({ ok: false, error: 'authenticated staff required' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const direction = String(body?.direction || '') as RmaDirection;
  if (!VALID_DIRECTIONS.has(direction)) {
    return NextResponse.json({ ok: false, error: `invalid direction: ${direction}` }, { status: 400 });
  }
  const orderIdRaw = body?.order_id;
  const customerIdRaw = body?.customer_id;
  const orderId =
    typeof orderIdRaw === 'number' && Number.isFinite(orderIdRaw) && orderIdRaw > 0 ? orderIdRaw : null;
  const customerId =
    typeof customerIdRaw === 'number' && Number.isFinite(customerIdRaw) && customerIdRaw > 0 ? customerIdRaw : null;
  const expectedCarrier =
    typeof body?.expected_carrier === 'string' && body.expected_carrier.trim()
      ? body.expected_carrier.trim()
      : null;
  const notes = typeof body?.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
  const expiresAt =
    typeof body?.expires_at === 'string' && body.expires_at.trim() ? body.expires_at.trim() : null;

  try {
    const result = await createAuthorization({
      direction,
      orderId,
      customerId,
      expectedCarrier,
      notes,
      expiresAt,
      createdByStaffId: actorStaffId,
    }, orgId);
    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'create rma failed';
    console.error('[POST /api/rma] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'orders.view' });
