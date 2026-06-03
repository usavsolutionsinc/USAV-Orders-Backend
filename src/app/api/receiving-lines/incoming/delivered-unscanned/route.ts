/**
 * GET /api/receiving-lines/incoming/delivered-unscanned
 *
 * The dependable "delivered but not checked-in" list for the Incoming view.
 *
 * Shipment-anchored (not PO-line-anchored): a carrier-confirmed delivery that
 * the dock hasn't started receiving. Scoped to INBOUND only — a shipment is
 * inbound when it has a `receiving` row OR its source_system is a receiving
 * origin. This deliberately excludes outbound order/packer tracking (which is
 * also "delivered, never scanned" but is not a dock arrival).
 *
 * "Not checked-in" = no operator `receiving_scans` against any linked receiving.
 * Deduped by normalized tracking# (carriers emit master+child numbers for the
 * same box) and windowed so the list stays actionable.
 *
 * Each row carries full PO context (PO#, vendor, expected date, product names)
 * resolved from the tracking# → Zoho PO link, so the "Delivered · not scanned"
 * facet renders them in the main incoming table like any other line. Read-only;
 * no carrier calls (use the Refresh button to re-poll first).
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';

export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 30;
const CAP = 100;

const INBOUND = `(
  EXISTS (SELECT 1 FROM receiving r WHERE r.shipment_id = stn.id)
  OR stn.source_system IN (
    'zoho_po','receiving_lookup_po','receiving_lines_patch','receiving.link-po','receiving_entry'
  )
)`;

export const GET = withAuth(async (_req: NextRequest) => {
  try {
    // Every inbound tracking# IS a Zoho PO's reference_number (the PO sync
    // registers it that way), so each box has full PO context even before a
    // dock scan. We resolve the PO id two ways and coalesce:
    //   1. the linked `receiving` row's zoho_purchaseorder_id (when present), or
    //   2. matching the normalized tracking# back to zoho_po_mirror.reference_number.
    // From the PO id we pull PO#, vendor + dates (zoho_po_mirror) and the
    // product/item names (receiving_lines — the mirror's `raw` is the Zoho PO
    // *list* shape, which omits line_items, so item names live on the lines).
    const { rows } = await pool.query<{
      shipment_id: number;
      carrier: string;
      tracking_number_raw: string;
      tracking_number_normalized: string;
      delivered_at: string | null;
      source_system: string | null;
      zoho_purchaseorder_id: string | null;
      po_number: string | null;
      vendor_name: string | null;
      expected_delivery_date: string | null;
      po_date: string | null;
      first_item_name: string | null;
      item_count: number | null;
    }>(
      `WITH base AS (
         SELECT DISTINCT ON (stn.tracking_number_normalized)
                stn.id                       AS shipment_id,
                stn.carrier,
                stn.tracking_number_raw,
                stn.tracking_number_normalized,
                stn.delivered_at::text       AS delivered_at,
                stn.source_system,
                COALESCE(
                  (SELECT r.zoho_purchaseorder_id
                     FROM receiving r
                    WHERE r.shipment_id = stn.id
                      AND r.zoho_purchaseorder_id IS NOT NULL
                    ORDER BY r.id LIMIT 1),
                  (SELECT m.zoho_purchaseorder_id
                     FROM zoho_po_mirror m
                    WHERE COALESCE(m.reference_number, '') <> ''
                      AND regexp_replace(upper(m.reference_number), '[^A-Z0-9]', '', 'g')
                          = stn.tracking_number_normalized
                    LIMIT 1)
                )                            AS zoho_purchaseorder_id
           FROM shipping_tracking_numbers stn
          WHERE stn.is_delivered = true
            AND stn.delivered_at > NOW() - ($1 || ' days')::interval
            AND ${INBOUND}
            AND NOT EXISTS (
              SELECT 1 FROM receiving r2
              JOIN receiving_scans rs ON rs.receiving_id = r2.id
              WHERE r2.shipment_id = stn.id
            )
          ORDER BY stn.tracking_number_normalized, stn.delivered_at DESC
       )
       SELECT base.*,
              COALESCE(
                m.zoho_purchaseorder_number,
                (SELECT r.zoho_purchaseorder_number
                   FROM receiving r
                  WHERE r.shipment_id = base.shipment_id
                    AND r.zoho_purchaseorder_number IS NOT NULL
                  ORDER BY r.id LIMIT 1)
              )                              AS po_number,
              m.vendor_name,
              m.expected_delivery_date::text AS expected_delivery_date,
              m.po_date::text                AS po_date,
              agg.first_item_name,
              agg.item_count
         FROM base
         LEFT JOIN zoho_po_mirror m ON m.zoho_purchaseorder_id = base.zoho_purchaseorder_id
         LEFT JOIN LATERAL (
           SELECT (array_agg(rl.item_name ORDER BY rl.id))[1] AS first_item_name,
                  COUNT(*)::int                                AS item_count
             FROM receiving_lines rl
            WHERE rl.zoho_purchaseorder_id = base.zoho_purchaseorder_id
              AND COALESCE(rl.item_name, '') <> ''
         ) agg ON TRUE`,
      [String(WINDOW_DAYS)],
    );

    // Most-recently-delivered first for display; cap defensively.
    const items = rows
      .sort((a, b) => (b.delivered_at ?? '').localeCompare(a.delivered_at ?? ''))
      .slice(0, CAP);

    return NextResponse.json({ success: true, count: items.length, window_days: WINDOW_DAYS, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load delivered-unscanned';
    console.error('incoming/delivered-unscanned failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, { permission: 'receiving.view' });
