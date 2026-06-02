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
             AND (stn.latest_status_category IS NULL OR stn.latest_status_category = 'UNKNOWN')
         )::int AS pending_carrier,
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
      awaiting_tracking: 0,
      expected_today: 0,
    };

    // `delivered_unopened` is shipment-anchored, not PO-line-anchored: the
    // packages that matter (carrier-delivered, no dock scan yet) are mostly
    // shipments registered from a PO reference# that never got a receiving
    // row, so the PO-line FILTER above misses them and always reads ~0. Scope
    // to INBOUND only (has a receiving row OR a receiving-origin source_system)
    // so outbound order/packer tracking can't leak in. Deduped by normalized
    // tracking#, windowed to stay actionable. Mirrors the list returned by
    // /api/receiving-lines/incoming/delivered-unscanned (same predicate) so the
    // tile count and that section always agree.
    const deliveredUnopened = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM (
         SELECT DISTINCT ON (stn.tracking_number_normalized) stn.id
           FROM shipping_tracking_numbers stn
          WHERE stn.is_delivered = true
            AND stn.delivered_at > NOW() - interval '30 days'
            AND (
              EXISTS (SELECT 1 FROM receiving r WHERE r.shipment_id = stn.id)
              OR stn.source_system IN (
                'zoho_po','receiving_lookup_po','receiving_lines_patch','receiving.link-po','receiving_entry'
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM receiving r2
              JOIN receiving_scans rs ON rs.receiving_id = r2.id
              WHERE r2.shipment_id = stn.id
            )
          ORDER BY stn.tracking_number_normalized, stn.delivered_at DESC
       ) d`,
    );
    row.delivered_unopened = Number(deliveredUnopened.rows[0]?.n ?? 0);

    return NextResponse.json({ success: true, ...row });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to compute summary';
    console.error('receiving-lines/incoming/summary failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, { permission: 'receiving.view' });
