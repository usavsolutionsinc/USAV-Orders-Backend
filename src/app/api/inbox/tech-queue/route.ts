/**
 * GET /api/inbox/tech-queue — the tech-station inbox backlog for the logged-in
 * staffer. Two buckets, derived live so the bell survives a reload and shows the
 * true backlog (not just whatever was pushed this session):
 *
 *   - return_pending_test : unboxed returns that still have a line needing test.
 *   - order_ready_ship    : unboxed priority cartons (a pending order needs the
 *                           contents) ready to fulfil/ship.
 *
 * Only primary-TECH staff get contents; everyone else gets an empty queue (the
 * client still subscribes to its own inbox channel — the publishers only fan out
 * to primary techs, so non-techs never receive the refetch events anyway).
 * staffId comes from the verified session; no special permission (own-data read).
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { isPrimaryTechStaff } from '@/lib/neon/staff-stations-queries';

export const runtime = 'nodejs';

type TechQueueItem = {
  kind: 'return_pending_test' | 'order_ready_ship';
  receivingId: number;
  trackingNumber: string | null;
  unboxedAt: string | null;
};

export const GET = withAuth(async (_req, ctx) => {
  const isTech = await isPrimaryTechStaff(ctx.staffId);
  if (!isTech) {
    return NextResponse.json({
      items: [] as TechQueueItem[],
      counts: { return_pending_test: 0, order_ready_ship: 0 },
    });
  }

  // Unboxed returns that still have at least one line needing test (not yet
  // resolved). The EXISTS clears the bucket once every line reaches a terminal
  // workflow state, so this bucket self-corrects without a manual dismiss.
  const returnsRes = await pool.query<{
    receiving_id: number;
    tracking: string | null;
    unboxed_at: string | null;
  }>(
    `SELECT r.id AS receiving_id,
            COALESCE(stn.tracking_number_raw, r.receiving_tracking_number) AS tracking,
            r.unboxed_at::text AS unboxed_at
       FROM receiving r
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
      WHERE COALESCE(r.is_return, false) = true
        AND r.unboxed_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM receiving_lines rl
           WHERE rl.receiving_id = r.id
             AND COALESCE(rl.needs_test, true) = true
             AND COALESCE(rl.workflow_status::text, '') NOT IN ('DONE','PASSED','FAILED','RTV','SCRAP')
        )
      ORDER BY r.unboxed_at DESC
      LIMIT 50`,
  );

  // Unboxed priority cartons (pending-order match or manual) ready to ship.
  // Bounded to a recent window as the v1 clear signal — there's no order-ship
  // hook yet, so the window keeps the bucket from growing without bound.
  const ordersRes = await pool.query<{
    receiving_id: number;
    tracking: string | null;
    unboxed_at: string | null;
  }>(
    `SELECT r.id AS receiving_id,
            COALESCE(stn.tracking_number_raw, r.receiving_tracking_number) AS tracking,
            r.unboxed_at::text AS unboxed_at
       FROM receiving r
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
      WHERE COALESCE(r.is_priority, false) = true
        AND COALESCE(r.is_return, false) = false
        AND r.unboxed_at IS NOT NULL
        AND r.unboxed_at > NOW() - interval '3 days'
      ORDER BY r.unboxed_at DESC
      LIMIT 50`,
  );

  const items: TechQueueItem[] = [
    ...returnsRes.rows.map((row) => ({
      kind: 'return_pending_test' as const,
      receivingId: Number(row.receiving_id),
      trackingNumber: row.tracking ?? null,
      unboxedAt: row.unboxed_at ?? null,
    })),
    ...ordersRes.rows.map((row) => ({
      kind: 'order_ready_ship' as const,
      receivingId: Number(row.receiving_id),
      trackingNumber: row.tracking ?? null,
      unboxedAt: row.unboxed_at ?? null,
    })),
  ];

  return NextResponse.json({
    items,
    counts: {
      return_pending_test: returnsRes.rowCount ?? 0,
      order_ready_ship: ordersRes.rowCount ?? 0,
    },
  });
});
