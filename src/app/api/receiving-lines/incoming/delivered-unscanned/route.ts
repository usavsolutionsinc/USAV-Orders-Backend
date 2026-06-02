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
 * These rows have no PO line to render in the main incoming table, so they get
 * their own sidebar section instead. Read-only; no carrier calls (use the
 * Refresh button to re-poll first).
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
    const { rows } = await pool.query<{
      shipment_id: number;
      carrier: string;
      tracking_number_raw: string;
      tracking_number_normalized: string;
      delivered_at: string | null;
      source_system: string | null;
      po_number: string | null;
    }>(
      `SELECT DISTINCT ON (stn.tracking_number_normalized)
              stn.id                       AS shipment_id,
              stn.carrier,
              stn.tracking_number_raw,
              stn.tracking_number_normalized,
              stn.delivered_at::text       AS delivered_at,
              stn.source_system,
              -- best-effort PO context when a receiving row happens to link
              (SELECT r.zoho_purchaseorder_number
                 FROM receiving r
                WHERE r.shipment_id = stn.id
                ORDER BY r.id LIMIT 1)      AS po_number
         FROM shipping_tracking_numbers stn
        WHERE stn.is_delivered = true
          AND stn.delivered_at > NOW() - ($1 || ' days')::interval
          AND ${INBOUND}
          AND NOT EXISTS (
            SELECT 1 FROM receiving r2
            JOIN receiving_scans rs ON rs.receiving_id = r2.id
            WHERE r2.shipment_id = stn.id
          )
        ORDER BY stn.tracking_number_normalized, stn.delivered_at DESC`,
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
