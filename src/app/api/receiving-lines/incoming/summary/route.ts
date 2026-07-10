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
import { tenantQuery } from '@/lib/tenancy/db';
import {
  getDeliveredUnscannedCount,
  getDeliveredUnscannedByCarrier,
  getEmailDeliveredUnscannedCount,
  NOT_ZOHO_RECEIVED_PREDICATE,
  CARRIER_MISMATCH_PREDICATE,
  SHIPMENT_SCANNED_PREDICATE,
} from '@/lib/receiving/delivered-unscanned';
import { getDeliveredNotUnboxedCount } from '@/lib/receiving/delivered-not-unboxed';
import { isIncomingUniversal } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_request: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId;
    const r = await tenantQuery<{
      issued: number;
      delivered_unopened: number;
      arriving_today: number;
      stalled: number;
      in_transit: number;
      pending_carrier: number;
      carrier_mismatch: number;
      tracking_unavailable: number;
      awaiting_tracking: number;
      expected_today: number;
    }>(
      orgId,
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
             AND NOT ${CARRIER_MISMATCH_PREDICATE}
         )::int AS pending_carrier,
         COUNT(DISTINCT rl.zoho_purchaseorder_id) FILTER (
           WHERE ${CARRIER_MISMATCH_PREDICATE}
         )::int AS carrier_mismatch,
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
             AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
             -- String-key join (PO id) collides across tenants; pin to same org.
             AND r.organization_id = rl.organization_id)
       )
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
       LEFT JOIN zoho_po_mirror mirror ON mirror.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
       WHERE rl.workflow_status = 'EXPECTED'
         AND COALESCE(rl.quantity_received, 0) = 0
         AND rl.zoho_purchaseorder_id IS NOT NULL
         -- Tenant ownership: only this org's incoming PO lines.
         AND rl.organization_id = $1
         -- Drop POs Zoho now reports received/closed/cancelled, so a
         -- received order leaves Incoming after a Refresh-Zoho mirror sync.
         AND ${NOT_ZOHO_RECEIVED_PREDICATE}
         -- A scanned box has left Incoming (it shows in the scanned view now), so
         -- exclude it here too — keeps these chip counts in sync with the list's
         -- view=incoming rows, which now apply the same scan guard.
         AND NOT ${SHIPMENT_SCANNED_PREDICATE}`,
      [orgId],
    );

    const row = r.rows[0] ?? {
      issued: 0,
      delivered_unopened: 0,
      arriving_today: 0,
      stalled: 0,
      in_transit: 0,
      pending_carrier: 0,
      carrier_mismatch: 0,
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
    // badges agree by construction. Threaded orgId → the helper takes its
    // GUC-wrapped tenant branch (the `pool` arg is ignored there, kept only to
    // satisfy the required positional), pinning the org-bearing aliases
    // (receiving/receiving_scans) inside the shared predicates so the tile no
    // longer counts other tenants' delivered-unscanned boxes.
    row.delivered_unopened = await getDeliveredUnscannedCount(pool, undefined, orgId);
    const delivered_not_unboxed = await getDeliveredNotUnboxedCount(orgId);

    // Email-driven delivered-unscanned: orders an "ORDER DELIVERED" email
    // flagged that map to a still-incoming, unscanned receiving line. Shown
    // alongside the carrier signal (both surface a delivered-but-not-scanned
    // box; email catches the ones carrier polling misses or can't reach).
    // Threaded orgId → the helper's tenant branch pins eds/rl on organization_id
    // AND aligns the org across the normalized-order# string-key join, matching
    // the sibling list endpoint's `eds.organization_id = rl.organization_id`, so
    // this org's count no longer mixes in other tenants' order#/PO# collisions.
    const deliveredEmail = await getEmailDeliveredUnscannedCount(pool, undefined, orgId);

    // E4 per-carrier breakdown — "USPS: 12 unavailable, FedEx: 3 delivered-
    // unscanned". delivered_unscanned reuses the deduped canonical base (sums to
    // the tile); blocked/in_transit are per-shipment but scoped to EXACTLY the
    // Incoming surface (still-incoming PO lines, reached via the same soft
    // receiving join the row endpoint + top-level tiles use), so the matrix
    // reflects the displayed list — NOT every inbound shipment ever registered,
    // which is what made USPS read 200+ "unavailable" while only a handful were
    // actually in the Incoming queue.
    const [duByCarrier, carrierAgg] = await Promise.all([
      // Threaded orgId → same org-pinned canonical base as the tile, split by
      // carrier, so each per-carrier delivered_unscanned value counts only this
      // org's inbound shipments (was aggregating every tenant's via bypass pool).
      getDeliveredUnscannedByCarrier(pool, undefined, orgId),
      tenantQuery<{
        carrier: string;
        tracking_unavailable: number;
        in_transit: number;
        carrier_mismatch: number;
      }>(
        orgId,
        // UNKNOWN is included so carrier/number mismatches (a tracking# we
        // couldn't attribute to any carrier) get a row of their own — they have
        // no UPS/USPS/FedEx bucket to live in, but still need surfacing.
        `WITH incoming_shipments AS (
           SELECT DISTINCT ON (stn.id)
                  stn.id,
                  stn.carrier,
                  stn.tracking_blocked_reason,
                  stn.is_delivered,
                  stn.is_terminal,
                  stn.latest_status_category,
                  stn.last_error_code
             FROM receiving_lines rl
             LEFT JOIN zoho_po_mirror mirror
               ON mirror.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
             JOIN LATERAL (
               SELECT r.* FROM receiving r
                WHERE r.id = rl.receiving_id
                   OR (rl.receiving_id IS NULL
                       AND r.source = 'zoho_po'
                       AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
                       -- String-key join (PO id) collides across tenants; pin to same org.
                       AND r.organization_id = rl.organization_id)
                ORDER BY (r.id = rl.receiving_id) DESC,
                         (r.shipment_id IS NOT NULL) DESC,
                         r.id DESC
                LIMIT 1
             ) r ON TRUE
             JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
            WHERE rl.workflow_status = 'EXPECTED'
              AND COALESCE(rl.quantity_received, 0) = 0
              AND rl.zoho_purchaseorder_id IS NOT NULL
              -- Tenant ownership: only this org's incoming PO lines.
              AND rl.organization_id = $1
              AND ${NOT_ZOHO_RECEIVED_PREDICATE}
              AND NOT ${SHIPMENT_SCANNED_PREDICATE}
              AND upper(COALESCE(stn.carrier, '')) IN ('UPS','USPS','FEDEX','UNKNOWN')
            ORDER BY stn.id
         )
         SELECT
                CASE WHEN upper(COALESCE(carrier, '')) IN ('UPS','USPS','FEDEX')
                     THEN upper(carrier) ELSE 'UNKNOWN' END AS carrier,
                COUNT(*) FILTER (
                  WHERE tracking_blocked_reason IS NOT NULL
                    AND COALESCE(is_delivered, false) = false
                )::int AS tracking_unavailable,
                COUNT(*) FILTER (
                  WHERE COALESCE(is_terminal, false) = false
                    AND latest_status_category IN ('IN_TRANSIT','ACCEPTED','LABEL_CREATED')
                )::int AS in_transit,
                COUNT(*) FILTER (
                  WHERE COALESCE(is_delivered, false) = false
                    AND COALESCE(is_terminal, false) = false
                    AND (
                      upper(COALESCE(carrier, '')) = 'UNKNOWN'
                      OR last_error_code IN ('NOT_FOUND','UNKNOWN_CARRIER')
                    )
                )::int AS carrier_mismatch
           FROM incoming_shipments
          GROUP BY 1`,
        [orgId],
      ),
    ]);

    const carriers: Array<'UPS' | 'USPS' | 'FEDEX'> = ['UPS', 'USPS', 'FEDEX'];
    const aggByCarrier = new Map(carrierAgg.rows.map((r) => [r.carrier, r]));
    const by_carrier: Array<{
      carrier: string;
      delivered_unscanned: number;
      tracking_unavailable: number;
      in_transit: number;
      carrier_mismatch: number;
    }> = carriers.map((carrier) => ({
      carrier,
      delivered_unscanned: duByCarrier[carrier] ?? 0,
      tracking_unavailable: aggByCarrier.get(carrier)?.tracking_unavailable ?? 0,
      in_transit: aggByCarrier.get(carrier)?.in_transit ?? 0,
      carrier_mismatch: aggByCarrier.get(carrier)?.carrier_mismatch ?? 0,
    }));

    // Append an UNKNOWN row only when there are unattributable mismatches — a
    // tracking# that matched no carrier has no UPS/USPS/FedEx row to sit in.
    const unknownAgg = aggByCarrier.get('UNKNOWN');
    if (unknownAgg && unknownAgg.carrier_mismatch > 0) {
      by_carrier.push({
        carrier: 'UNKNOWN',
        delivered_unscanned: 0,
        tracking_unavailable: unknownAgg.tracking_unavailable ?? 0,
        in_transit: unknownAgg.in_transit ?? 0,
        carrier_mismatch: unknownAgg.carrier_mismatch ?? 0,
      });
    }

    // Universal Incoming (flag-gated): eBay buyer lines still awaiting their Zoho
    // PO — the "Needs Zoho link (n)" pill (plan §6.2/§8.2). 0 when the flag is off
    // so the response shape and the legacy Zoho-only tiles are unchanged.
    let ebay_pending = 0;
    if (await isIncomingUniversal(orgId)) {
      const er = await tenantQuery<{ ebay_pending: number }>(
        orgId,
        `SELECT COUNT(*) FILTER (
                  WHERE rl.inbound_source_type = 'ebay' AND rl.zoho_purchaseorder_id IS NULL
                )::int AS ebay_pending
           FROM receiving_lines rl
          WHERE rl.organization_id = $1
            AND rl.workflow_status = 'EXPECTED'
            AND COALESCE(rl.quantity_received, 0) = 0`,
        [orgId],
      );
      ebay_pending = er.rows[0]?.ebay_pending ?? 0;
    }

    return NextResponse.json({
      success: true,
      ...row,
      delivered_not_unboxed,
      delivered_email: deliveredEmail,
      ebay_pending,
      by_carrier,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to compute summary';
    console.error('receiving-lines/incoming/summary failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, { permission: 'receiving.view' });
