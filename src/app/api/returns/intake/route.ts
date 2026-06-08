import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { isInventoryV2Returns } from '@/lib/feature-flags';
import { parseScannedUrl } from '@/lib/scan-resolver';
import { processReturnsIntake } from '@/lib/inventory/returns';

/**
 * POST /api/returns/intake
 *
 * Phase 7 returns dock. For each resolved unit:
 *   - inventory_events RETURNED (prev=current, next='RETURNED')
 *   - serial_units.current_status → RETURNED
 *   - sku_stock_ledger +1 reason='RETURN_CUSTOMER' (trigger projects
 *     the qty back onto sku_stock.stock)
 *
 * Body:
 *   {
 *     tracking_number?: string,
 *     order_id?: number,
 *     reason?: string,
 *     serials?: string[],         // raw serials or GS1 Digital Link URLs
 *     serial_unit_ids?: number[],
 *     client_event_id?: string    // UUID, per-unit suffixed for idempotency
 *   }
 *
 * Shared transaction in src/lib/inventory/returns.ts (used by the
 * /admin/inventory/returns admin page too).
 *
 * Gated by INVENTORY_V2_RETURNS; off-flag returns 503.
 * Permission: receiving.mark_received.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!isInventoryV2Returns()) {
    return NextResponse.json(
      { ok: false, error: 'INVENTORY_V2_RETURNS flag is OFF', flag: 'INVENTORY_V2_RETURNS' },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => ({}));

  const rawSerials: string[] = Array.isArray(body?.serials)
    ? body.serials.map((s: unknown) => String(s ?? '').trim()).filter(Boolean)
    : [];
  const serialUnitIds: number[] = Array.isArray(body?.serial_unit_ids)
    ? body.serial_unit_ids
        .map((x: unknown) => Number(x))
        .filter((n: number) => Number.isFinite(n) && n > 0)
        .map((n: number) => Math.floor(n))
    : [];

  // Extract per-unit serial from any GS1 Digital Link URLs in the input.
  const normalizedSerials = rawSerials.map((raw) => {
    const url = parseScannedUrl(raw);
    return url && url.type === 'unit' ? url.unitSerial.toUpperCase() : raw.toUpperCase();
  });

  const orderIdRaw = Number(body?.order_id);
  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;

  try {
    const result = await processReturnsIntake({
      serials: normalizedSerials,
      serialUnitIds,
      trackingNumber: String(body?.tracking_number || '').trim() || null,
      orderId: Number.isFinite(orderIdRaw) && orderIdRaw > 0 ? Math.floor(orderIdRaw) : null,
      reason: String(body?.reason || '').trim() || null,
      clientEventId: String(body?.client_event_id || '').trim() || null,
      actorStaffId,
      organizationId: ctx.organizationId ?? null,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          ...(result.missingSerials ? { missing_serials: result.missingSerials } : {}),
          ...(result.missingIds ? { missing_ids: result.missingIds } : {}),
        },
        { status: result.status },
      );
    }
    return NextResponse.json({
      ok: true,
      returned_unit_count: result.returnedUnitCount,
      order_id: result.orderId,
      tracking_number: result.trackingNumber,
      units: result.units,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'returns intake failed';
    console.error('[POST /api/returns/intake] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'receiving.mark_received' });
