/**
 * GET /api/receiving-lines/incoming/summary
 *
 * Stat-tile aggregate for the Incoming pill on the receiving page. One
 * query. Tile counts are **distinct Zoho PO ids** — a 5-line PO that's
 * delivered counts as 1 box, not 5 lines (operators think in POs/boxes).
 *
 * Each bucket mirrors the predicate the main `/api/receiving-lines?view=incoming`
 * SELECT uses for its `delivery_state` CASE so chip counts and rendered rows
 * stay in sync.
 *
 * Response shape:
 * {
 *   issued: number,              // distinct POs with workflow=EXPECTED + qty_received=0
 *   delivered_unopened: number,  // + carrier delivered AND no operator scan logged yet
 *   arriving_today: number,      // + carrier=OUT_FOR_DELIVERY
 *   stalled: number,             // alive shipment with carrier exception OR no scan in >72h
 *   in_transit: number,          // + carrier=IN_TRANSIT/ACCEPTED/LABEL_CREATED
 *   pending_carrier: number,     // tracking# registered, carrier sync returned no status yet
 *   awaiting_tracking: number,   // no tracking# registered at all
 *   expected_today: number,      // joined zoho_po_mirror.expected_delivery_date = today (PST)
 * }
 *
 * Polled by IncomingSidebarPanel every 30s via React Query. No write side.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import {
  getDeliveredUnscannedCount,
  getDeliveredUnscannedByCarrier,
  INBOUND_SHIPMENT_PREDICATE,
} from '@/lib/receiving/delivered-unscanned';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_request: NextRequest) => {
  try {
    const r = await pool.query<{
      issued: number;
      delivered_unopened: number;
      arriving_today: number;
      stalled: number;
      in_transit: number;
      pending_carrier: number;
      tracking_unavailable: number;
      awaiting_tracking: number;
      expected_today: number;
    }>(
      `SELECT
         COUNT(DISTINCT rl.zoho_purchaseorder_id)::int AS issued,
         COUNT(DISTINCT rl.zoho_purchaseorder_id) FILTER (
           WHERE stn.is_delivered = true
             AND NOT EXISTS (
               SELECT 1 FROM receiving_scans rs WHERE rs.receiving_id = r.id
             )
         )::int AS delivered_unopened,
         COUNT(DISTINCT rl.zoho_purchaseorder_id) FILTER (
           WHERE stn.latest_status_category = 'OUT_FOR_DELIVERY'
         )::int AS arriving_today,
         COUNT(DISTINCT rl.zoho_purchaseorder_id) FILTER (
           WHERE stn.id IS NOT NULL
             AND COALESCE(stn.is_terminal, false) = false
             AND COALESCE(stn.is_delivered, false) = false
             AND (
               stn.has_exception = true
               OR (stn.latest_event_at IS NOT NULL
                   AND stn.latest_event_at < (NOW() - interval '72 hours'))
             )
         )::int AS stalled,
         COUNT(DISTINCT rl.zoho_purchaseorder_id) FILTER (
           WHERE stn.latest_status_category IN ('IN_TRANSIT','ACCEPTED','LABEL_CREATED')
         )::int AS in_transit,
         COUNT(DISTINCT rl.zoho_purchaseorder_id) FILTER (
           WHERE stn.id IS NOT NULL
             AND stn.tracking_blocked_reason IS NULL
             AND (stn.latest_status_category IS NULL OR stn.latest_status_category = 'UNKNOWN')
         )::int AS pending_carrier,
         COUNT(DISTINCT rl.zoho_purchaseorder_id) FILTER (
           WHERE stn.tracking_blocked_reason IS NOT NULL
             AND COALESCE(stn.is_delivered, false) = false
         )::int AS tracking_unavailable,
         COUNT(DISTINCT rl.zoho_purchaseorder_id) FILTER (
           WHERE stn.id IS NULL
         )::int AS awaiting_tracking,
         COUNT(DISTINCT rl.zoho_purchaseorder_id) FILTER (
           WHERE mirror.expected_delivery_date = (NOW() AT TIME ZONE 'America/Los_Angeles')::date
         )::int AS expected_today
       FROM receiving_lines rl
       LEFT JOIN receiving r ON (
            r.id = rl.receiving_id
         OR (rl.receiving_id IS NULL
             AND r.source = 'zoho_po'
             AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id)
       )
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
       LEFT JOIN zoho_po_mirror mirror ON mirror.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
       WHERE rl.workflow_status = 'EXPECTED'
         AND COALESCE(rl.quantity_received, 0) = 0
         AND rl.zoho_purchaseorder_id IS NOT NULL`,
    );

    const row = r.rows[0] ?? {
      issued: 0,
      delivered_unopened: 0,
      arriving_today: 0,
      stalled: 0,
      in_transit: 0,
      pending_carrier: 0,
      tracking_unavailable: 0,
      awaiting_tracking: 0,
      expected_today: 0,
    };

    // `delivered_unopened` is shipment-anchored, not PO-line-anchored: the
    // packages that matter (carrier-delivered, no dock scan yet) are mostly
    // shipments registered from a PO reference# that never got a receiving row,
    // so the PO-line FILTER above misses them and always reads ~0. The canonical
    // count lives in one helper (Phase B) shared with the list endpoint and the
    // main delivery_state, so the tile count, the list length, and the row
    // badges agree by construction.
    row.delivered_unopened = await getDeliveredUnscannedCount(pool);

    // E4 per-carrier breakdown — "USPS: 12 unavailable, FedEx: 3 delivered-
    // unscanned". delivered_unscanned reuses the deduped canonical base (sums to
    // the tile); blocked/in_transit are per-STN over the inbound predicate.
    const [duByCarrier, carrierAgg] = await Promise.all([
      getDeliveredUnscannedByCarrier(pool),
      pool.query<{ carrier: string; tracking_unavailable: number; in_transit: number }>(
        `SELECT stn.carrier,
                COUNT(*) FILTER (
                  WHERE stn.tracking_blocked_reason IS NOT NULL
                    AND COALESCE(stn.is_delivered, false) = false
                )::int AS tracking_unavailable,
                COUNT(*) FILTER (
                  WHERE COALESCE(stn.is_terminal, false) = false
                    AND stn.latest_status_category IN ('IN_TRANSIT','ACCEPTED','LABEL_CREATED')
                )::int AS in_transit
           FROM shipping_tracking_numbers stn
          WHERE stn.carrier IN ('UPS','USPS','FEDEX')
            AND ${INBOUND_SHIPMENT_PREDICATE}
          GROUP BY stn.carrier`,
      ),
    ]);

    const carriers: Array<'UPS' | 'USPS' | 'FEDEX'> = ['UPS', 'USPS', 'FEDEX'];
    const aggByCarrier = new Map(carrierAgg.rows.map((r) => [r.carrier, r]));
    const by_carrier = carriers.map((carrier) => ({
      carrier,
      delivered_unscanned: duByCarrier[carrier] ?? 0,
      tracking_unavailable: aggByCarrier.get(carrier)?.tracking_unavailable ?? 0,
      in_transit: aggByCarrier.get(carrier)?.in_transit ?? 0,
    }));

    return NextResponse.json({ success: true, ...row, by_carrier });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to compute summary';
    console.error('receiving-lines/incoming/summary failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, { permission: 'receiving.view' });
