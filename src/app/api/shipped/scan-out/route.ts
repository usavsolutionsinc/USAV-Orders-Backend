import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { createStationActivityLog } from '@/lib/station-activity';
import { createAuditLog, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { normalizePSTTimestamp } from '@/utils/date';

/**
 * POST /api/shipped/scan-out — the dock "scan out the label" event.
 *
 * Records that a packed package physically left the building (SHIP_CONFIRM on
 * station_activity_logs), stamping the "left the warehouse" time onto the
 * tracking number's timeline. This is the second, separate scan from pack-out:
 * pack = "in the box", scan-out = "gone". It is NOT the carrier custody signal
 * (that arrives later on shipping_tracking_numbers via webhook/poll).
 *
 * Append-only + idempotent: a package leaves once, so a second scan of the same
 * label returns the existing event rather than duplicating it.
 */
export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const raw = String(
      (body?.trackingNumber ?? body?.tracking ?? body?.scan ?? '') as string,
    ).trim();

    if (!raw) {
      return NextResponse.json({ ok: false, error: 'tracking number required' }, { status: 400 });
    }

    // Resolve the scan to an existing shipment (registers/syncs an unknown
    // carrier tracking the same way the pack station does).
    const { shipmentId } = await resolveShipmentId(raw);
    if (shipmentId == null) {
      return NextResponse.json(
        { ok: true, matched: false, message: 'No shipment found for this label' },
        { status: 200 },
      );
    }

    // Light context for the toast / running list (best-effort).
    const ctxRow = await pool
      .query(
        `SELECT stn.tracking_number_raw AS tracking,
                o.order_id              AS order_id,
                o.product_title         AS product_title
         FROM shipping_tracking_numbers stn
         LEFT JOIN orders o ON o.shipment_id = stn.id
         WHERE stn.id = $1
         ORDER BY o.id DESC
         LIMIT 1`,
        [shipmentId],
      )
      .then((r) => r.rows[0] ?? null)
      .catch(() => null);

    // Idempotency: a package leaves once. Return the existing event if present.
    const existing = await pool.query(
      `SELECT id, to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at, staff_id
       FROM station_activity_logs
       WHERE activity_type = 'SHIP_CONFIRM' AND shipment_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [shipmentId],
    );
    if (existing.rows[0]) {
      return NextResponse.json({
        ok: true,
        matched: true,
        duplicate: true,
        shipmentId,
        shipConfirmedAt: existing.rows[0].created_at,
        tracking: ctxRow?.tracking ?? raw,
        orderId: ctxRow?.order_id ?? null,
        productTitle: ctxRow?.product_title ?? null,
      });
    }

    const createdAt = body?.createdAt ? normalizePSTTimestamp(body.createdAt as string) : null;
    const activityId = await createStationActivityLog(pool, {
      organizationId: ctx.organizationId,
      station: 'OUTBOUND',
      activityType: 'SHIP_CONFIRM',
      staffId: ctx.staffId,
      shipmentId,
      scanRef: raw,
      notes: 'Scanned out at dock',
      metadata: { source: 'shipped-scan-out' },
      createdAt,
    });

    // Audit: the package physically left the warehouse (mirrors packing-logs PACK_COMPLETED).
    await createAuditLog(pool, {
      actorStaffId: ctx.staffId,
      source: 'api.shipped.scan-out',
      action: AUDIT_ACTION.SHIP_CONFIRM_SCAN,
      entityType: AUDIT_ENTITY.SHIPMENT,
      entityId: String(shipmentId),
      stationActivityLogId: activityId,
      metadata: {
        tracking: ctxRow?.tracking ?? raw,
        order_id: ctxRow?.order_id ?? null,
      },
    }).catch(() => {});

    // Bust the shipped/packer-logs cache so the two tables reflect the move.
    await invalidateCacheTags(['packing-logs', 'shipped']).catch(() => {});

    return NextResponse.json({
      ok: true,
      matched: true,
      duplicate: false,
      shipmentId,
      activityId,
      tracking: ctxRow?.tracking ?? raw,
      orderId: ctxRow?.order_id ?? null,
      productTitle: ctxRow?.product_title ?? null,
    });
  },
  { permission: 'shipping.mark_shipped' },
);
