import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import type { SerialUnitRow } from '@/lib/neon/serial-units-queries';
import { registerShipmentPermissive } from '@/lib/shipping/sync-shipment';
import { withAuth } from '@/lib/auth/withAuth';
import { sortSerialUnitToParts } from '@/lib/inventory/parts-sort';
import {
  normalizeReceivingHistorySearchField,
  normalizeReceivingHistorySearchScope,
  receivingHistorySkipsUnmatchedPlaceholders,
  type ReceivingHistorySearchField,
  type ReceivingHistorySearchScope,
} from '@/lib/receiving-history-search';

type LineSerial = {
  id: number;
  serial_number: string;
  current_status: string;
  sku_catalog_id: number | null;
  condition_grade: string | null;
  created_at: string;
};

async function fetchSerialsForLines(lineIds: number[]): Promise<Map<number, LineSerial[]>> {
  const grouped = new Map<number, LineSerial[]>();
  if (lineIds.length === 0) return grouped;

  const result = await pool.query<SerialUnitRow>(
    `SELECT id, serial_number, current_status, sku_catalog_id, condition_grade,
            origin_receiving_line_id, created_at
     FROM serial_units
     WHERE origin_receiving_line_id = ANY($1::int[])
     ORDER BY created_at ASC, id ASC`,
    [lineIds],
  );

  for (const row of result.rows) {
    const lineId = row.origin_receiving_line_id;
    if (lineId == null) continue;
    const slim: LineSerial = {
      id: Number(row.id),
      serial_number: row.serial_number,
      current_status: row.current_status,
      sku_catalog_id: row.sku_catalog_id,
      condition_grade: row.condition_grade,
      created_at: row.created_at,
    };
    const bucket = grouped.get(lineId);
    if (bucket) bucket.push(slim);
    else grouped.set(lineId, [slim]);
  }

  return grouped;
}

const QA_STATUSES  = new Set(['PENDING', 'PASSED', 'FAILED_DAMAGED', 'FAILED_INCOMPLETE', 'FAILED_FUNCTIONAL', 'HOLD']);
const DISPOSITIONS = new Set(['ACCEPT', 'HOLD', 'RTV', 'SCRAP', 'REWORK']);
const WORKFLOW_STATUSES = new Set([
  'EXPECTED', 'ARRIVED', 'MATCHED', 'UNBOXED', 'AWAITING_TEST',
  'IN_TEST', 'PASSED', 'FAILED', 'RTV', 'SCRAP', 'DONE',
]);
const CONDITIONS   = new Set(['BRAND_NEW', 'LIKE_NEW', 'REFURBISHED', 'USED_A', 'USED_B', 'USED_C', 'PARTS']);

function parsePositiveTechId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

// ─── GET ──────────────────────────────────────────────────────────────────────
// ?id=<n>              → single row
// ?receiving_id=<n>    → all lines for a package
// ?limit&offset&search → paginated list (omit receiving_id to get all)
export const GET = withAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const id          = Number(searchParams.get('id'));
    const receivingId = Number(searchParams.get('receiving_id'));
    const limit       = Math.min(Number(searchParams.get('limit') || 200), 500);
    const offset      = Math.max(Number(searchParams.get('offset') || 0), 0);
    const search      = String(searchParams.get('search') || '').trim();
    const searchField: ReceivingHistorySearchField =
      normalizeReceivingHistorySearchField(searchParams.get('search_field'));
    const searchScope: ReceivingHistorySearchScope =
      normalizeReceivingHistorySearchScope(searchParams.get('search_scope'));
    const qaFilter    = String(searchParams.get('qa_status') || '').trim().toUpperCase();
    const dispFilter  = String(searchParams.get('disposition') || '').trim().toUpperCase();
    const workflowFilter = String(searchParams.get('workflow_status') || '').trim().toUpperCase();
    const weekStart = String(searchParams.get('week_start') || '').trim();
    const weekEnd   = String(searchParams.get('week_end') || '').trim();
    const viewRaw   = String(searchParams.get('view') || '').trim().toLowerCase();
    // Incoming-only: filters by the computed delivery_state bucket
    // (DELIVERED_UNOPENED, ARRIVING_TODAY, STALLED, IN_TRANSIT, AWAITING_TRACKING).
    // Mirrors the stat-tile click semantics on IncomingSidebarPanel.
    const deliveryStateFilter = String(searchParams.get('delivery_state') || '')
      .trim()
      .toUpperCase();
    // Incoming-only: optional PO purchase-date range. ISO YYYY-MM-DD;
    // anything malformed silently no-ops so bookmarks survive.
    const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const poFromRaw = String(searchParams.get('po_from') || '').trim();
    const poToRaw = String(searchParams.get('po_to') || '').trim();
    const poFrom = isISODate(poFromRaw) ? poFromRaw : '';
    const poTo = isISODate(poToRaw) ? poToRaw : '';
    // Incoming-only: sort axis. Defaults to most-recently-issued-in-Zoho.
    const sortRaw = String(searchParams.get('sort') || '').trim().toLowerCase();
    const incomingSort:
      | 'zoho_newest'
      | 'zoho_oldest'
      | 'expected_soonest'
      | 'recently_added' =
      sortRaw === 'zoho_oldest'
        ? 'zoho_oldest'
        : sortRaw === 'expected_soonest'
          ? 'expected_soonest'
          : sortRaw === 'recently_added'
            ? 'recently_added'
            : 'zoho_newest';
    const view: 'all' | 'recent' | 'received' | 'incoming' | 'activity' | 'testing' | null =
      viewRaw === 'recent' ? 'recent'
        : viewRaw === 'received' ? 'received'
        : viewRaw === 'all' ? 'all'
        : viewRaw === 'incoming' ? 'incoming'
        : viewRaw === 'activity' ? 'activity'
        : viewRaw === 'testing' ? 'testing'
        : null;
    // view=testing only: scope the recently-tested feed to one staff member.
    const testerId = Number(searchParams.get('tester'));
    const include     = String(searchParams.get('include') || '').trim().toLowerCase();
    const includeSerials = include.split(',').map((s) => s.trim()).includes('serials');

    // Single row
    if (Number.isFinite(id) && id > 0) {
      const one = await pool.query(
        `SELECT rl.*,
                r.receiving_tracking_number,
                r.carrier,
                r.source                     AS receiving_source,
                r.source_platform            AS receiving_source_platform,
                r.zoho_purchaseorder_number  AS receiving_zoho_purchaseorder_number,
                r.support_notes              AS receiving_support_notes,
                r.listing_url                AS receiving_listing_url,
                stn.tracking_number_raw      AS shipment_tracking_number,
                stn.carrier                  AS shipment_carrier,
                stn.latest_status_category   AS shipment_status_category,
                stn.is_delivered             AS shipment_is_delivered,
                stn.delivered_at             AS shipment_delivered_at,
                sc.image_url,
                (SELECT COUNT(*) FROM photos p
                  WHERE p.entity_type = 'RECEIVING'
                    AND p.entity_id = rl.receiving_id) AS photo_count
         FROM receiving_lines rl
         -- Soft JOIN: direct FK when set, else PO#-based fallback. Partial
         -- unique index ux_receiving_zoho_po_matched (source='zoho_po') ensures
         -- at most one PO-matched receiving row per PO, so no dedup needed.
         LEFT JOIN receiving r ON (
              r.id = rl.receiving_id
           OR (rl.receiving_id IS NULL
               AND r.source = 'zoho_po'
               AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id)
         )
         LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
         LEFT JOIN sku_catalog sc                ON sc.sku = rl.sku
         WHERE rl.id = $1`,
        [id],
      );
      if (one.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
      }
      const normalized = normalizeRow(one.rows[0]);
      if (includeSerials) {
        const serialsByLine = await fetchSerialsForLines([normalized.id]);
        (normalized as Record<string, unknown>).serials = serialsByLine.get(normalized.id) ?? [];
      }
      // Mobile `/receiving/lines/:id` historically read `receiving_lines[]`; desktop sidebar uses `receiving_line`.
      return NextResponse.json({
        success: true,
        receiving_line: normalized,
        receiving_lines: [normalized],
      });
    }

    // All lines for a specific package
    if (Number.isFinite(receivingId) && receivingId > 0) {
      const [rows, pkgRes] = await Promise.all([
        pool.query(
          `SELECT rl.*,
                  r.receiving_tracking_number,
                  r.carrier,
                  r.source                     AS receiving_source,
                  r.source_platform            AS receiving_source_platform,
                  r.zoho_purchaseorder_number  AS receiving_zoho_purchaseorder_number,
                  r.support_notes              AS receiving_support_notes,
                  r.listing_url                AS receiving_listing_url,
                  stn.tracking_number_raw      AS shipment_tracking_number,
                  stn.carrier                  AS shipment_carrier,
                  stn.latest_status_category   AS shipment_status_category,
                  stn.is_delivered             AS shipment_is_delivered,
                  stn.delivered_at             AS shipment_delivered_at,
                  sc.image_url,
                  (SELECT COUNT(*) FROM photos p
                    WHERE p.entity_type = 'RECEIVING'
                      AND p.entity_id = rl.receiving_id) AS photo_count
           FROM receiving_lines rl
           LEFT JOIN receiving r                   ON r.id  = rl.receiving_id
           LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
           LEFT JOIN sku_catalog sc                ON sc.sku = rl.sku
           WHERE rl.receiving_id = $1
           ORDER BY rl.id ASC`,
          [receivingId],
        ),
        pool.query(
          `SELECT received_at::text AS received_at,
                  unboxed_at::text AS unboxed_at,
                  created_at::text AS created_at,
                  return_platform::text AS return_platform,
                  source_platform,
                  COALESCE(is_return, false) AS is_return
           FROM receiving
           WHERE id = $1
           LIMIT 1`,
          [receivingId],
        ),
      ]);
      const normalizedRows = rows.rows.map(normalizeRow);
      if (includeSerials) {
        const serialsByLine = await fetchSerialsForLines(normalizedRows.map((r) => r.id));
        for (const row of normalizedRows) {
          (row as Record<string, unknown>).serials = serialsByLine.get(row.id) ?? [];
        }
      }
      const receiving_package = pkgRes.rows[0]
        ? {
            received_at: (pkgRes.rows[0].received_at as string | null) ?? null,
            unboxed_at: (pkgRes.rows[0].unboxed_at as string | null) ?? null,
            created_at: (pkgRes.rows[0].created_at as string | null) ?? null,
            return_platform: (pkgRes.rows[0].return_platform as string | null) ?? null,
            source_platform: (pkgRes.rows[0].source_platform as string | null) ?? null,
            is_return: !!pkgRes.rows[0].is_return,
          }
        : null;
      return NextResponse.json({ success: true, receiving_lines: normalizedRows, receiving_package });
    }

    // Paginated list — all lines, optionally filtered
    const conditions: string[] = [];
    const values: unknown[]    = [];
    let idx = 1;

    if (search) {
      const p = `%${search}%`;
      // Carton/handle QR payloads are `R-<id>` (see src/lib/barcode-routing.ts).
      // Treat that as an explicit receiving_id equality so scanning a label
      // narrows the list to that package.
      const rcvIdMatch = /^R-(\d+)$/i.exec(search);
      const rcvIdEq = rcvIdMatch ? Number(rcvIdMatch[1]) : NaN;
      switch (searchField) {
        case 'po':
          conditions.push(
            `(COALESCE(rl.zoho_purchaseorder_id::text, '') ILIKE $${idx}
             OR COALESCE(rl.zoho_purchaseorder_number, '') ILIKE $${idx}
             OR COALESCE(r.zoho_purchaseorder_number, '') ILIKE $${idx})`,
          );
          values.push(p);
          idx++;
          break;
        case 'tracking':
          conditions.push(
            `(COALESCE(r.receiving_tracking_number, '') ILIKE $${idx}
             OR COALESCE(stn.tracking_number_raw, '') ILIKE $${idx}
             OR COALESCE(stn.tracking_number_normalized, '') ILIKE $${idx})`,
          );
          values.push(p);
          idx++;
          break;
        case 'sku':
          conditions.push(
            `(COALESCE(rl.sku, '') ILIKE $${idx}
             OR COALESCE(rl.zoho_item_id, '') ILIKE $${idx})`,
          );
          values.push(p);
          idx++;
          break;
        case 'product':
          conditions.push(`COALESCE(rl.item_name, '') ILIKE $${idx}`);
          values.push(p);
          idx++;
          break;
        case 'serial':
          conditions.push(
            `EXISTS (
               SELECT 1 FROM serial_units su_hist
               WHERE su_hist.origin_receiving_line_id = rl.id
                 AND COALESCE(su_hist.serial_number, '') ILIKE $${idx}
             )`,
          );
          values.push(p);
          idx++;
          break;
        default: {
          const patternIdx = idx;
          const orClauses = [
            `COALESCE(rl.item_name, '') ILIKE $${patternIdx}`,
            `COALESCE(rl.sku, '') ILIKE $${patternIdx}`,
            `COALESCE(rl.zoho_purchaseorder_id::text, '') ILIKE $${patternIdx}`,
            `COALESCE(rl.zoho_purchaseorder_number, '') ILIKE $${patternIdx}`,
            `COALESCE(rl.zoho_item_id, '') ILIKE $${patternIdx}`,
            `COALESCE(r.zoho_purchaseorder_number, '') ILIKE $${patternIdx}`,
            `COALESCE(r.receiving_tracking_number, '') ILIKE $${patternIdx}`,
            `COALESCE(stn.tracking_number_raw, '') ILIKE $${patternIdx}`,
            `COALESCE(stn.tracking_number_normalized, '') ILIKE $${patternIdx}`,
            `EXISTS (
               SELECT 1 FROM serial_units su_all
               WHERE su_all.origin_receiving_line_id = rl.id
                 AND COALESCE(su_all.serial_number, '') ILIKE $${patternIdx}
             )`,
          ];
          values.push(p);
          idx++;

          if (Number.isFinite(rcvIdEq)) {
            orClauses.push(`rl.receiving_id = $${idx}`);
            values.push(rcvIdEq);
            idx++;
          }

          conditions.push(`(${orClauses.join(' OR ')})`);
          break;
        }
      }
    }
    if (searchScope === 'zoho_po') {
      conditions.push(`r.source = $${idx}`);
      values.push('zoho_po');
      idx++;
    } else if (searchScope === 'unmatched') {
      conditions.push(`r.source = $${idx}`);
      values.push('unmatched');
      idx++;
    }
    if (qaFilter && QA_STATUSES.has(qaFilter)) {
      conditions.push(`rl.qa_status = $${idx++}`);
      values.push(qaFilter);
    }
    if (dispFilter && DISPOSITIONS.has(dispFilter)) {
      conditions.push(`rl.disposition_code = $${idx++}`);
      values.push(dispFilter);
    }
    if (workflowFilter && WORKFLOW_STATUSES.has(workflowFilter)) {
      conditions.push(`rl.workflow_status = $${idx++}::inbound_workflow_status_enum`);
      values.push(workflowFilter);
    }
    // `view` overrides week-range scoping. Otherwise week range still applies.
    if (view === 'recent') {
      // Recently scanned, not yet matched to a PO or received. MATCHED and
      // anything further live in the Received tab.
      conditions.push(
        `rl.workflow_status IN ('EXPECTED','ARRIVED')`,
      );
    } else if (view === 'received') {
      // "Received" = physically in the warehouse. Anything from MATCHED
      // onward qualifies (the row strip labels MATCHED as "RECEIVED").
      // Terminal fails (SCRAP, RTV, FAILED) are excluded — they land in
      // the per-status filters instead.
      conditions.push(
        `rl.workflow_status IN ('MATCHED','UNBOXED','AWAITING_TEST','IN_TEST','PASSED','DONE')`,
      );
    } else if (view === 'all') {
      // Union of recent + received. Includes NULL workflow_status so legacy
      // rows without a status still appear. Terminal fails (SCRAP/RTV/FAILED)
      // stay in per-status filters.
      conditions.push(
        `(rl.workflow_status IS NULL OR rl.workflow_status IN ('EXPECTED','ARRIVED','MATCHED','UNBOXED','AWAITING_TEST','IN_TEST','PASSED','DONE'))`,
      );
    } else if (view === 'activity') {
      // "Activity" = the recent-activity rail feed: everything that has actually
      // been physically touched. Identical to `view=all` EXCEPT it drops the
      // untouched-incoming rows (EXPECTED with nothing received yet) that belong
      // in the Incoming view — those leak into the rail under `all`. A line shows
      // here once it has been scanned/received (quantity_received > 0) OR its
      // workflow has advanced past EXPECTED.
      conditions.push(
        `(rl.workflow_status IS NULL OR rl.workflow_status IN ('EXPECTED','ARRIVED','MATCHED','UNBOXED','AWAITING_TEST','IN_TEST','PASSED','DONE'))
         AND NOT (rl.workflow_status = 'EXPECTED' AND COALESCE(rl.quantity_received, 0) = 0)`,
      );
    } else if (view === 'testing') {
      // "Testing" = the recently-tested feed, backed by the testing_results
      // log. A line qualifies once it has at least one recorded verdict; when
      // a tester is supplied we scope to that staff's own tested items. Ordered
      // by rl.updated_at below — the per-verdict line rollup bumps it, so the
      // most recently tested rises to the top.
      if (Number.isFinite(testerId) && testerId > 0) {
        conditions.push(
          `EXISTS (SELECT 1 FROM testing_results tr
                    WHERE tr.receiving_line_id = rl.id AND tr.tested_by = $${idx})`,
        );
        values.push(testerId);
        idx++;
      } else {
        conditions.push(
          `EXISTS (SELECT 1 FROM testing_results tr WHERE tr.receiving_line_id = rl.id)`,
        );
      }
    } else if (view === 'incoming') {
      // "Incoming" = on a Zoho PO, vendor has issued it, warehouse hasn't
      // touched it yet. Backed by the /api/cron/zoho/incoming-po-sync delta
      // poller. A row drops off this view the instant the operator scans
      // or marks-received against it (workflow advances past EXPECTED OR
      // quantity_received goes positive). Unmatched cartons stay in their
      // own pill — this view is strictly Zoho-sourced expected work.
      conditions.push(
        `rl.workflow_status = 'EXPECTED'
         AND COALESCE(rl.quantity_received, 0) = 0
         AND rl.zoho_purchaseorder_id IS NOT NULL`,
      );

      // Optional delivery_state facet filter. Each bucket is the exact same
      // predicate the CASE expression in the SELECT below uses so the chip
      // counts in IncomingSidebarPanel stay consistent with the rendered rows.
      if (deliveryStateFilter === 'DELIVERED_UNOPENED') {
        // Carrier delivered the box AND no operator scan happened yet at the
        // receiving station. `receiving_scans` is written by /lookup-po the
        // moment someone scans the tracking#, so its absence is the precise
        // "this box is here but nobody has touched it" signal.
        conditions.push(
          `stn.is_delivered = true
           AND NOT EXISTS (
             SELECT 1 FROM receiving_scans rs WHERE rs.receiving_id = r.id
           )`,
        );
      } else if (deliveryStateFilter === 'ARRIVING_TODAY') {
        conditions.push(`stn.latest_status_category = 'OUT_FOR_DELIVERY'`);
      } else if (deliveryStateFilter === 'STALLED') {
        // Shipment is alive (not terminal, not delivered) but either the carrier
        // flagged an exception or no new scan has landed in >72h. This is the
        // "vendor said it shipped but it isn't actually moving" bucket — the
        // single highest-value receiving signal to surface ahead of the day.
        conditions.push(
          `stn.id IS NOT NULL
           AND COALESCE(stn.is_terminal, false) = false
           AND COALESCE(stn.is_delivered, false) = false
           AND (
             stn.has_exception = true
             OR (
               stn.latest_event_at IS NOT NULL
               AND stn.latest_event_at < (NOW() - interval '72 hours')
             )
           )`,
        );
      } else if (deliveryStateFilter === 'IN_TRANSIT') {
        conditions.push(
          `stn.latest_status_category IN ('IN_TRANSIT','ACCEPTED','LABEL_CREATED')`,
        );
      } else if (deliveryStateFilter === 'AWAITING_TRACKING') {
        // Strictly: no carrier tracking# registered. Distinct from
        // PENDING_CARRIER (tracking# exists, no status pulled yet).
        conditions.push(`stn.id IS NULL`);
      } else if (deliveryStateFilter === 'PENDING_CARRIER') {
        // Tracking# is registered with a known carrier but the carrier sync
        // hasn't returned a useful status (NULL / UNKNOWN). Common right
        // after registration; also catches USPS shipments where the sync
        // adapter isn't returning a category. Different from AWAITING_TRACKING
        // because the tracking chip on the row is real and clickable.
        conditions.push(
          `stn.id IS NOT NULL
            AND (stn.latest_status_category IS NULL OR stn.latest_status_category = 'UNKNOWN')`,
        );
      }

      // PO purchase-date range filter. Joins zoho_po_mirror (already joined
      // via incomingExtrasJoin) so we use its `po_date` (Zoho's PO date).
      // Falls back to local created_at when the mirror doesn't have the PO
      // yet (rare — happens only between cron tick + receive).
      if (poFrom) {
        conditions.push(
          `COALESCE(mirror.po_date::text, rl.created_at::date::text) >= $${idx++}`,
        );
        values.push(poFrom);
      }
      if (poTo) {
        conditions.push(
          `COALESCE(mirror.po_date::text, rl.created_at::date::text) <= $${idx++}`,
        );
        values.push(poTo);
      }
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(weekStart) && /^\d{4}-\d{2}-\d{2}$/.test(weekEnd)) {
      conditions.push(`rl.created_at >= $${idx++}::date AND rl.created_at < ($${idx++}::date + INTERVAL '1 day')`);
      values.push(weekStart, weekEnd);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // view=recent sorts by the most recent tracking→PO pairing event for the
    // carton (max receiving_scans.scanned_at), so freshly-paired lines rise
    // to the top. Falls back to receiving.received_at, then rl.created_at.
    // view=received sorts by updated_at (when the line was last touched).
    // Default mirrors the prior behavior.
    // Incoming uses its own sort axis driven by `?sort=`:
    //   zoho_newest     — Zoho PO date DESC (most recently issued first)
    //   zoho_oldest     — Zoho PO date ASC (clear oldest backlog first)
    //   expected_soonest — vendor-promised delivery date ASC (today first)
    //   recently_added  — local created_at DESC (most recent sync hit)
    // NULL po_date values sort last in either direction.
    const incomingOrderBy =
      incomingSort === 'zoho_oldest'
        ? `ORDER BY mirror.po_date ASC NULLS LAST, rl.id ASC`
        : incomingSort === 'expected_soonest'
          ? `ORDER BY mirror.expected_delivery_date ASC NULLS LAST, rl.id ASC`
          : incomingSort === 'recently_added'
            ? `ORDER BY rl.created_at DESC, rl.id DESC`
            : `ORDER BY mirror.po_date DESC NULLS LAST, rl.id DESC`;
    const orderBy =
      view === 'incoming'
        ? incomingOrderBy
        : view === 'recent' || view === 'all' || view === 'activity'
          ? `ORDER BY COALESCE(rs_agg.last_scan::text, r.received_at::text, rl.created_at::text) DESC, rl.id DESC`
          : view === 'received' || view === 'testing'
            ? `ORDER BY COALESCE(rl.updated_at::text, rl.created_at::text) DESC, rl.id DESC`
            : `ORDER BY COALESCE(rl.zoho_last_modified_time, rl.created_at::text) DESC, rl.id DESC`;
    // The lateral aggregate is needed for view=recent and view=all so the
    // most recently paired cartons bubble up. Cheap at this scale.
    const recentScansJoin = view === 'recent' || view === 'all' || view === 'activity'
      ? `LEFT JOIN LATERAL (
            SELECT MAX(rs.scanned_at) AS last_scan
            FROM receiving_scans rs
            WHERE rs.receiving_id = r.id
         ) rs_agg ON TRUE`
      : '';

    // Fetch extra line rows when `view=all` so merged Zoho-less placeholders
    // can displace the tail of the list after sort (Recent + History share this).
    const lineFetchLimit = view === 'all' ? Math.min(limit + 200, 600) : limit;
    values.push(lineFetchLimit, offset);

    const lastScanSelect = view === 'recent' || view === 'all' || view === 'activity'
      ? `, rs_agg.last_scan::text AS last_scan_at`
      : '';

    // Incoming-only extras: derived delivery_state bucket + expected_delivery_date
    // from zoho_po_mirror. delivery_state is computed on read (CQRS-style) so a
    // carrier status flip (IN_TRANSIT → DELIVERED) shows the right bucket on
    // the next page load with no sync write. zoho_po_mirror JOIN is constrained
    // by the unique zoho_purchaseorder_id key so it stays 1:1.
    const incomingExtrasSelect =
      view === 'incoming'
        ? `,
                CASE
                  WHEN COALESCE(rl.quantity_received, 0) > 0 OR rl.workflow_status <> 'EXPECTED'
                    THEN 'RECEIVED'
                  WHEN stn.is_delivered = true
                       AND NOT EXISTS (
                         SELECT 1 FROM receiving_scans rs WHERE rs.receiving_id = r.id
                       )
                    THEN 'DELIVERED_UNOPENED'
                  WHEN stn.latest_status_category = 'OUT_FOR_DELIVERY'
                    THEN 'ARRIVING_TODAY'
                  WHEN stn.id IS NOT NULL
                       AND COALESCE(stn.is_terminal, false) = false
                       AND COALESCE(stn.is_delivered, false) = false
                       AND (
                         stn.has_exception = true
                         OR (stn.latest_event_at IS NOT NULL
                             AND stn.latest_event_at < (NOW() - interval '72 hours'))
                       )
                    THEN 'STALLED'
                  WHEN stn.latest_status_category IN ('IN_TRANSIT','ACCEPTED','LABEL_CREATED')
                    THEN 'IN_TRANSIT'
                  WHEN stn.id IS NULL
                    THEN 'AWAITING_TRACKING'
                  WHEN stn.latest_status_category IS NULL OR stn.latest_status_category = 'UNKNOWN'
                    THEN 'PENDING_CARRIER'
                  ELSE 'UNKNOWN'
                END AS delivery_state,
                stn.has_exception                    AS shipment_has_exception,
                stn.latest_event_at::text            AS shipment_latest_event_at,
                stn.is_terminal                      AS shipment_is_terminal,
                mirror.po_date::text                 AS po_date,
                mirror.expected_delivery_date::text  AS expected_delivery_date,
                mirror.vendor_name::text             AS vendor_name`
        : '';
    const incomingExtrasJoin =
      view === 'incoming'
        ? `LEFT JOIN zoho_po_mirror mirror ON mirror.zoho_purchaseorder_id = rl.zoho_purchaseorder_id`
        : '';

    const [rowsRes, countRes] = await Promise.all([
      pool.query(
        `SELECT rl.*,
                r.receiving_tracking_number,
                r.carrier,
                r.received_at::text          AS receiving_received_at,
                r.source                     AS receiving_source,
                r.source_platform            AS receiving_source_platform,
                r.zoho_purchaseorder_number  AS receiving_zoho_purchaseorder_number,
                r.support_notes              AS receiving_support_notes,
                r.listing_url                AS receiving_listing_url,
                stn.tracking_number_raw      AS shipment_tracking_number,
                stn.carrier                  AS shipment_carrier,
                stn.latest_status_category   AS shipment_status_category,
                stn.is_delivered             AS shipment_is_delivered,
                stn.delivered_at             AS shipment_delivered_at,
                sc.image_url,
                (SELECT COUNT(*) FROM photos p
                  WHERE p.entity_type = 'RECEIVING'
                    AND p.entity_id = rl.receiving_id) AS photo_count
                ${lastScanSelect}
                ${incomingExtrasSelect}
         FROM receiving_lines rl
         -- Soft JOIN: direct FK when set, else PO#-based fallback (see note above).
         LEFT JOIN receiving r ON (
              r.id = rl.receiving_id
           OR (rl.receiving_id IS NULL
               AND r.source = 'zoho_po'
               AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id)
         )
         LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
         LEFT JOIN sku_catalog sc                ON sc.sku = rl.sku
         ${recentScansJoin}
         ${incomingExtrasJoin}
         ${where}
         ${orderBy}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        values,
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM receiving_lines rl
         LEFT JOIN receiving r ON (
              r.id = rl.receiving_id
           OR (rl.receiving_id IS NULL
               AND r.source = 'zoho_po'
               AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id)
         )
         LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
         ${incomingExtrasJoin}
         ${where}`,
        values.slice(0, -2),
      ),
    ]);

    let normalizedList = rowsRes.rows.map(normalizeRow);
    let total = Number(countRes.rows[0]?.total ?? 0);
    if (includeSerials) {
      const serialsByLine = await fetchSerialsForLines(normalizedList.map((r) => r.id));
      for (const row of normalizedList) {
        (row as Record<string, unknown>).serials = serialsByLine.get(row.id) ?? [];
      }
    }

    const includeUnmatchedPlaceholders =
      view === 'all' &&
      searchScope !== 'zoho_po' &&
      !receivingHistorySkipsUnmatchedPlaceholders(searchField);

    if (includeUnmatchedPlaceholders) {
      const unmatchedSearchVals: unknown[] = [];
      let unmatchedSearchSql = '';
      if (search) {
        unmatchedSearchVals.push(`%${search}%`);
        if (searchField === 'po') {
          unmatchedSearchSql =
            ` AND COALESCE(r.zoho_purchaseorder_number, '') ILIKE $1`;
        } else if (searchField === 'tracking') {
          unmatchedSearchSql = ` AND (
               COALESCE(r.receiving_tracking_number, '') ILIKE $1
            OR COALESCE(stn.tracking_number_raw, '') ILIKE $1
            OR COALESCE(stn.tracking_number_normalized, '') ILIKE $1
          )`;
        } else {
          unmatchedSearchSql = ` AND (
               COALESCE(r.receiving_tracking_number, '') ILIKE $1
            OR COALESCE(stn.tracking_number_raw, '') ILIKE $1
            OR COALESCE(stn.tracking_number_normalized, '') ILIKE $1
            OR COALESCE(r.zoho_purchaseorder_number, '') ILIKE $1
          )`;
        }
      }
      const [unmatchedPkgsRes, unmatchedCntRes] = await Promise.all([
        pool.query(
          `SELECT r.id,
                  r.receiving_tracking_number,
                  r.carrier,
                  r.received_at::text          AS receiving_received_at,
                  r.created_at::text           AS created_at,
                  r.support_notes              AS receiving_support_notes,
                  r.listing_url                AS receiving_listing_url,
                  r.source_platform            AS receiving_source_platform,
                  r.source                     AS receiving_source,
                  r.zoho_purchaseorder_number  AS receiving_zoho_purchaseorder_number,
                  stn.tracking_number_raw      AS shipment_tracking_number,
                  stn.carrier                  AS shipment_carrier,
                  stn.latest_status_category   AS shipment_status_category,
                  stn.is_delivered             AS shipment_is_delivered,
                  stn.delivered_at::text       AS shipment_delivered_at,
                  rs_agg.last_scan::text       AS last_scan_at,
                  (SELECT COUNT(*) FROM photos p
                     WHERE p.entity_type = 'RECEIVING'
                       AND p.entity_id = r.id) AS photo_count
           FROM receiving r
           LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
           LEFT JOIN LATERAL (
               SELECT MAX(rs.scanned_at) AS last_scan
               FROM receiving_scans rs
               WHERE rs.receiving_id = r.id
            ) rs_agg ON TRUE
           WHERE r.source = 'unmatched'
             AND NOT EXISTS (
               SELECT 1 FROM receiving_lines rl WHERE rl.receiving_id = r.id
             )
             ${unmatchedSearchSql}
           ORDER BY COALESCE(rs_agg.last_scan::text, r.received_at::text, r.created_at::text) DESC NULLS LAST,
                    r.id DESC
           LIMIT 150`,
          unmatchedSearchVals,
        ),
        pool.query(
          `SELECT COUNT(*)::bigint AS n
             FROM receiving r
             LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
            WHERE r.source = 'unmatched'
              AND NOT EXISTS (
                SELECT 1 FROM receiving_lines rl WHERE rl.receiving_id = r.id
              )
              ${unmatchedSearchSql}`,
          unmatchedSearchVals,
        ),
      ]);
      total += Number(unmatchedCntRes.rows[0]?.n ?? 0);
      const placeholderNorm = unmatchedPkgsRes.rows.map((pkg) =>
        normalizeRow(buildUnmatchedEmptyReceivingLine(pkg as Record<string, unknown>)),
      );
      for (const row of placeholderNorm) {
        if (includeSerials) (row as Record<string, unknown>).serials = [];
      }
      normalizedList = [...normalizedList, ...placeholderNorm].sort((a, b) =>
        compareReceivingRowsByRecentActivity(a, b),
      );
      normalizedList = normalizedList.slice(offset, offset + limit);
    }

    return NextResponse.json({
      success: true,
      receiving_lines: normalizedList,
      total,
      limit,
      offset,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch receiving lines';
    console.error('receiving-lines GET failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}, { permission: 'receiving.view' });

// ─── POST ─────────────────────────────────────────────────────────────────────
export const POST = withAuth(async (request: NextRequest) => {
  try {
    const body = await request.json();

    const receivingIdRaw = body?.receiving_id;
    const receivingId    = receivingIdRaw != null ? Number(receivingIdRaw) : null;
    const zohoItemId     = String(body?.zoho_item_id || '').trim();
    const zohoLineItemId = String(body?.zoho_line_item_id || '').trim() || null;
    const zohoPurchaseReceiveId = String(body?.zoho_purchase_receive_id || '').trim() || null;
    const zohoPurchaseOrderId   = String(body?.zoho_purchaseorder_id || '').trim() || null;
    const itemName       = String(body?.item_name || '').trim() || null;
    const sku            = String(body?.sku || '').trim() || null;
    const notes          = String(body?.notes || '').trim() || null;

    const qtyReceivedRaw   = Number(body?.quantity_received ?? body?.quantity ?? 0);
    const quantityReceived = Number.isFinite(qtyReceivedRaw) && qtyReceivedRaw >= 0 ? Math.floor(qtyReceivedRaw) : 0;

    const qtyExpectedRaw  = Number(body?.quantity_expected);
    const quantityExpected = Number.isFinite(qtyExpectedRaw) && qtyExpectedRaw > 0 ? Math.floor(qtyExpectedRaw) : null;

    const qaStatusRaw  = String(body?.qa_status || 'PENDING').trim().toUpperCase();
    const dispositionRaw = String(body?.disposition_code || 'HOLD').trim().toUpperCase();
    const conditionRaw   = String(body?.condition_grade || 'USED_A').trim().toUpperCase();
    const dispositionAudit = Array.isArray(body?.disposition_audit) ? body.disposition_audit : [];
    const assignedTechId = parsePositiveTechId(body?.assigned_tech_id ?? body?.assignedTechId);
    const needsTest = body?.needs_test === undefined && body?.needsTest === undefined
      ? true
      : !!(body?.needs_test ?? body?.needsTest);

    if (!zohoItemId) {
      return NextResponse.json({ success: false, error: 'zoho_item_id is required' }, { status: 400 });
    }
    if (receivingId !== null && (!Number.isFinite(receivingId) || receivingId <= 0)) {
      return NextResponse.json({ success: false, error: 'receiving_id must be a positive integer or null' }, { status: 400 });
    }
    if (!QA_STATUSES.has(qaStatusRaw)) {
      return NextResponse.json({ success: false, error: 'Invalid qa_status' }, { status: 400 });
    }
    if (!DISPOSITIONS.has(dispositionRaw)) {
      return NextResponse.json({ success: false, error: 'Invalid disposition_code' }, { status: 400 });
    }
    if (!CONDITIONS.has(conditionRaw)) {
      return NextResponse.json({ success: false, error: 'Invalid condition_grade' }, { status: 400 });
    }

    const result = await pool.query(
      `INSERT INTO receiving_lines (
        receiving_id, zoho_item_id, zoho_line_item_id, zoho_purchase_receive_id,
        zoho_purchaseorder_id, item_name, sku,
        quantity_received, quantity_expected,
        qa_status, disposition_code, condition_grade, disposition_audit, notes,
        needs_test, assigned_tech_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16)
      RETURNING *`,
      [
        receivingId, zohoItemId, zohoLineItemId, zohoPurchaseReceiveId,
        zohoPurchaseOrderId, itemName, sku,
        quantityReceived, quantityExpected,
        qaStatusRaw, dispositionRaw, conditionRaw, JSON.stringify(dispositionAudit), notes,
        needsTest, assignedTechId,
      ],
    );

    const lineId = result.rows[0]?.id;
    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({ action: 'insert', rowId: String(lineId), source: 'receiving-lines.create' });

    return NextResponse.json({ success: true, receiving_line: normalizeRow(result.rows[0]) }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create receiving line';
    console.error('receiving-lines POST failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}, { permission: 'receiving.mark_received' });

// ─── PATCH ────────────────────────────────────────────────────────────────────
export const PATCH = withAuth(async (request: NextRequest, ctx) => {
  try {
    const body = await request.json();
    const id   = Number(body?.id);

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Valid id is required' }, { status: 400 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    // zoho_reference_number dropped in 2026-04-15_drop_zoho_reference_number.sql.
    // A body payload for that key is still accepted (sidebar tracking edits
    // send it) — handled below via the canonical shipment path, not a column
    // write.
    const textFields: Array<[string, string | null]> = [
      ['item_name',                 String(body?.item_name ?? '').trim() || null],
      ['sku',                       String(body?.sku ?? '').trim() || null],
      ['zoho_item_id',              String(body?.zoho_item_id ?? '').trim() || null],
      ['zoho_line_item_id',         String(body?.zoho_line_item_id ?? '').trim() || null],
      ['zoho_purchase_receive_id',  String(body?.zoho_purchase_receive_id ?? '').trim() || null],
      ['zoho_purchaseorder_id',     String(body?.zoho_purchaseorder_id ?? '').trim() || null],
      ['zoho_purchaseorder_number', String(body?.zoho_purchaseorder_number ?? '').trim() || null],
      ['notes',                     String(body?.notes ?? '').trim() || null],
      ['receiving_type',            String(body?.receiving_type ?? '').trim() || null],
      ['zendesk_ticket',            String(body?.zendesk_ticket ?? '').trim() || null],
    ];
    for (const [col, val] of textFields) {
      if (Object.prototype.hasOwnProperty.call(body, col.replace('zoho_item_id', 'zoho_item_id'))) {
        if (body[col] !== undefined) {
          updates.push(`${col} = $${idx++}`);
          values.push(val);
        }
      }
    }

    if (body?.receiving_id !== undefined) {
      const raw = body.receiving_id != null ? Number(body.receiving_id) : null;
      updates.push(`receiving_id = $${idx++}`);
      values.push(raw != null && Number.isFinite(raw) && raw > 0 ? raw : null);
    }

    if (body?.quantity_received !== undefined || body?.quantity !== undefined) {
      const raw = Number(body?.quantity_received ?? body?.quantity ?? 0);
      const nextReceived =
        Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
      updates.push(`quantity_received = $${idx++}`);
      values.push(nextReceived);
    }

    if (body?.quantity_expected !== undefined) {
      const raw = Number(body.quantity_expected);
      updates.push(`quantity_expected = $${idx++}`);
      values.push(Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null);
    }

    if (body?.qa_status !== undefined) {
      const qa = String(body.qa_status || '').trim().toUpperCase();
      if (!QA_STATUSES.has(qa)) {
        return NextResponse.json({ success: false, error: 'Invalid qa_status' }, { status: 400 });
      }
      updates.push(`qa_status = $${idx++}`);
      values.push(qa);
    }

    if (body?.disposition_code !== undefined) {
      const d = String(body.disposition_code || '').trim().toUpperCase();
      if (!DISPOSITIONS.has(d)) {
        return NextResponse.json({ success: false, error: 'Invalid disposition_code' }, { status: 400 });
      }
      updates.push(`disposition_code = $${idx++}`);
      values.push(d);
    }

    let isPartsCondition = false;
    if (body?.condition_grade !== undefined) {
      const c = String(body.condition_grade || '').trim().toUpperCase();
      if (!CONDITIONS.has(c)) {
        return NextResponse.json({ success: false, error: 'Invalid condition_grade' }, { status: 400 });
      }
      updates.push(`condition_grade = $${idx++}`);
      values.push(c);
      isPartsCondition = c === 'PARTS';
    }

    if (body?.disposition_audit !== undefined) {
      updates.push(`disposition_audit = $${idx++}::jsonb`);
      values.push(JSON.stringify(Array.isArray(body.disposition_audit) ? body.disposition_audit : []));
    }

    if (body?.assigned_tech_id !== undefined || body?.assignedTechId !== undefined) {
      updates.push(`assigned_tech_id = $${idx++}`);
      values.push(parsePositiveTechId(body?.assigned_tech_id ?? body?.assignedTechId));
    }

    if (body?.needs_test !== undefined || body?.needsTest !== undefined) {
      const nextNeedsTest = !!(body?.needs_test ?? body?.needsTest);
      if (!nextNeedsTest) {
        const existing = await pool.query<{ assigned_tech_id: number | null }>(
          `SELECT assigned_tech_id FROM receiving_lines WHERE id = $1`,
          [id],
        );
        if (existing.rows.length === 0) {
          return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
        }
        const effectiveTechId =
          parsePositiveTechId(body?.assigned_tech_id ?? body?.assignedTechId) ??
          parsePositiveTechId(existing.rows[0]?.assigned_tech_id);
        if (!effectiveTechId) {
          return NextResponse.json(
            { success: false, error: 'needs_test can only be cleared after a technician is assigned' },
            { status: 400 },
          );
        }
      }
      updates.push(`needs_test = $${idx++}`);
      values.push(nextNeedsTest);
    } else if (isPartsCondition) {
      // A "For Parts" line skips testing entirely — clear needs_test so it
      // drops out of the test queue. Parts don't require a tech assignment,
      // so this bypasses the tech-assignment guard above.
      updates.push(`needs_test = $${idx++}`);
      values.push(false);
    }

    const hasTrackingEdit = body?.zoho_reference_number !== undefined;
    if (updates.length === 0 && !hasTrackingEdit) {
      return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 });
    }

    // Run the UPDATE only when there are real column writes. A tracking-only
    // edit (zoho_reference_number body key) runs purely through the shipment
    // path below since the column it used to write to was dropped in
    // 2026-04-15_drop_zoho_reference_number.sql.
    let updatedRow: { id: number; receiving_id: number | null } | null = null;
    if (updates.length > 0) {
      values.push(id);
      const result = await pool.query(
        `UPDATE receiving_lines SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING id, receiving_id`,
        values,
      );
      if (result.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
      }
      updatedRow = result.rows[0];
    }

    // "For Parts" line → sort every serial already attached to this line into
    // the Technical Room parts bin (STOCKED, pickable). Best-effort: a sort
    // failure must not fail the PATCH.
    if (isPartsCondition) {
      try {
        const serials = await pool.query<{ id: number }>(
          `SELECT id FROM serial_units WHERE origin_receiving_line_id = $1`,
          [id],
        );
        for (const s of serials.rows) {
          await sortSerialUnitToParts({
            serialUnitId: s.id,
            staffId: ctx.staffId ?? null,
            station: 'RECEIVING',
          });
        }
      } catch (sortErr) {
        console.warn('[receiving-lines PATCH] parts auto-sort failed (non-fatal)', sortErr);
      }
    }

    // Canonical tracking path: a manual tracking submission registers the
    // shipment and attaches it to the line's receiving row. Overrides any
    // auto-attached shipment because a manual edit is explicit intent.
    if (hasTrackingEdit) {
      const tracking = String(body.zoho_reference_number ?? '').trim();
      const shipment = tracking
        ? await registerShipmentPermissive({
            trackingNumber: tracking,
            sourceSystem: 'receiving_lines_patch',
          })
        : null;
      let receivingIdForLine = updatedRow?.receiving_id ?? null;
      if (receivingIdForLine == null) {
        const existing = await pool.query<{ receiving_id: number | null }>(
          `SELECT receiving_id FROM receiving_lines WHERE id = $1`,
          [id],
        );
        if (existing.rows.length === 0) {
          return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
        }
        receivingIdForLine = existing.rows[0].receiving_id ?? null;
      }
      if (shipment && receivingIdForLine != null) {
        await pool.query(
          `UPDATE receiving SET shipment_id = $1 WHERE id = $2`,
          [shipment.id, receivingIdForLine],
        );
      }
    }

    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({ action: 'update', rowId: String(id), source: 'receiving-lines.update' });

    // Re-fetch with the shipment JOIN so the response carries the just-attached
    // shipment's tracking/carrier/status fields.
    const fresh = await pool.query(
      `SELECT rl.*,
              r.receiving_tracking_number,
              r.carrier,
              r.source                     AS receiving_source,
              r.source_platform            AS receiving_source_platform,
              r.zoho_purchaseorder_number  AS receiving_zoho_purchaseorder_number,
              r.support_notes              AS receiving_support_notes,
              r.listing_url                AS receiving_listing_url,
              stn.tracking_number_raw      AS shipment_tracking_number,
              stn.carrier                  AS shipment_carrier,
              stn.latest_status_category   AS shipment_status_category,
              stn.is_delivered             AS shipment_is_delivered,
              stn.delivered_at             AS shipment_delivered_at
         FROM receiving_lines rl
         LEFT JOIN receiving r                   ON r.id  = rl.receiving_id
         LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
        WHERE rl.id = $1`,
      [id],
    );
    if (fresh.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, receiving_line: normalizeRow(fresh.rows[0]) });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to update receiving line';
    console.error('receiving-lines PATCH failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}, { permission: 'receiving.mark_received' });

// ─── DELETE ───────────────────────────────────────────────────────────────────
export const DELETE = withAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Valid id is required' }, { status: 400 });
    }

    const result = await pool.query(`DELETE FROM receiving_lines WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
    }

    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({ action: 'delete', rowId: String(id), source: 'receiving-lines.delete' });

    return NextResponse.json({ success: true, id });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to delete receiving line';
    console.error('receiving-lines DELETE failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}, { permission: 'receiving.mark_received' });

/** Label for unmatched cartons that have no `receiving_lines` yet (Recent + History). */
const UNMATCHED_EMPTY_LINE_LABEL = 'Unfound receiving';

/**
 * `normalizeRow` input: synthetic line id `-receiving_id`, real `receiving_id`
 * (matches `buildUnmatchedStubRow` in the sidebar).
 */
function buildUnmatchedEmptyReceivingLine(pkg: Record<string, unknown>): Record<string, unknown> {
  const rid = Number(pkg.id);
  return {
    id: -rid,
    receiving_id: rid,
    receiving_tracking_number: pkg.receiving_tracking_number,
    carrier: pkg.carrier,
    receiving_received_at: pkg.receiving_received_at,
    receiving_support_notes: pkg.receiving_support_notes ?? null,
    receiving_listing_url: pkg.receiving_listing_url ?? null,
    receiving_source: 'unmatched',
    receiving_source_platform: pkg.receiving_source_platform,
    receiving_zoho_purchaseorder_number: pkg.receiving_zoho_purchaseorder_number,
    shipment_tracking_number: pkg.shipment_tracking_number,
    shipment_carrier: pkg.shipment_carrier,
    shipment_status_category: pkg.shipment_status_category,
    shipment_is_delivered: pkg.shipment_is_delivered,
    shipment_delivered_at: pkg.shipment_delivered_at,
    item_name: UNMATCHED_EMPTY_LINE_LABEL,
    sku: null,
    zoho_item_id: null,
    zoho_line_item_id: null,
    zoho_purchase_receive_id: null,
    zoho_purchaseorder_id: null,
    zoho_purchaseorder_number: pkg.receiving_zoho_purchaseorder_number ?? null,
    quantity_received: 0,
    quantity_expected: null,
    qa_status: 'PENDING',
    workflow_status: 'EXPECTED',
    disposition_code: 'HOLD',
    condition_grade: 'BRAND_NEW',
    disposition_audit: [],
    needs_test: true,
    assigned_tech_id: null,
    zoho_sync_source: null,
    zoho_last_modified_time: null,
    zoho_synced_at: null,
    notes: null,
    receiving_type: 'PO',
    created_at: pkg.created_at,
    last_scan_at: pkg.last_scan_at,
    image_url: null,
    photo_count: pkg.photo_count,
    zoho_reference_number: null,
  };
}

function receivingRowActivityTs(row: {
  last_activity_at?: string | null;
  created_at?: string | null;
}) {
  const raw = row.last_activity_at ?? row.created_at ?? null;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function compareReceivingRowsByRecentActivity(
  a: { last_activity_at?: string | null; created_at?: string | null; id: number },
  b: { last_activity_at?: string | null; created_at?: string | null; id: number },
) {
  const d = receivingRowActivityTs(b) - receivingRowActivityTs(a);
  return d !== 0 ? d : b.id - a.id;
}

// ─── Normalize ────────────────────────────────────────────────────────────────
function normalizeRow(row: Record<string, unknown>) {
  // Tracking identity resolves in priority order:
  //   1. shipping_tracking_numbers (canonical — joined via receiving.shipment_id)
  //   2. receiving.receiving_tracking_number (legacy text on the package)
  //   3. receiving_lines.zoho_reference_number (legacy text on the line;
  //      column may be absent post-retirement — guarded below)
  // See inbound-tracking unification plan (2026-04-15 migrations).
  const shipmentTracking    = (row.shipment_tracking_number as string | null) ?? null;
  const receivingTracking   = (row.receiving_tracking_number as string | null) ?? null;
  const zohoReferenceNumber = (row.zoho_reference_number as string | null) ?? null;

  const tracking =
    shipmentTracking ?? receivingTracking ?? zohoReferenceNumber ?? null;
  const trackingSource =
    shipmentTracking ? 'shipment'
    : receivingTracking ? 'receiving'
    : zohoReferenceNumber ? 'zoho_reference'
    : null;

  // Carrier from the canonical shipment row wins; fall back to the legacy
  // receiving.carrier text. 'UNKNOWN' sentinel (from permissive registration)
  // is hidden — surfaces as null so UI renders plainly.
  const shipmentCarrierRaw = (row.shipment_carrier as string | null) ?? null;
  const shipmentCarrier = shipmentCarrierRaw && shipmentCarrierRaw.toUpperCase() !== 'UNKNOWN'
    ? shipmentCarrierRaw
    : null;
  const carrier = shipmentCarrier ?? (row.carrier as string | null) ?? null;

  return {
    id:                       Number(row.id),
    receiving_id:             row.receiving_id != null ? Number(row.receiving_id) : null,
    tracking_number:          tracking,
    tracking_source:          trackingSource,
    zoho_reference_number:    zohoReferenceNumber,
    carrier,
    shipment_status:          (row.shipment_status_category as string | null) ?? null,
    is_delivered:             !!row.shipment_is_delivered,
    delivered_at:             (row.shipment_delivered_at as string | null) ?? null,
    zoho_item_id:             (row.zoho_item_id as string | null) ?? null,
    zoho_line_item_id:        (row.zoho_line_item_id as string | null) ?? null,
    zoho_purchase_receive_id: (row.zoho_purchase_receive_id as string | null) ?? null,
    zoho_purchaseorder_id:    (row.zoho_purchaseorder_id as string | null) ?? null,
    zoho_purchaseorder_number: (row.zoho_purchaseorder_number as string | null) ?? (row.receiving_zoho_purchaseorder_number as string | null) ?? null,
    item_name:                (row.item_name as string | null) ?? null,
    sku:                      (row.sku as string | null) ?? null,
    quantity_received:        Number(row.quantity_received ?? 0),
    quantity_expected:        row.quantity_expected != null ? Number(row.quantity_expected) : null,
    qa_status:                (row.qa_status as string) ?? 'PENDING',
    workflow_status:          (row.workflow_status as string | null) ?? null,
    disposition_code:         (row.disposition_code as string) ?? 'HOLD',
    condition_grade:          (row.condition_grade as string) ?? 'USED_A',
    disposition_audit:        (row.disposition_audit as unknown[]) ?? [],
    needs_test:               !!row.needs_test,
    assigned_tech_id:         row.assigned_tech_id != null ? Number(row.assigned_tech_id) : null,
    zoho_sync_source:         (row.zoho_sync_source as string | null) ?? null,
    zoho_last_modified_time:  (row.zoho_last_modified_time as string | null) ?? null,
    zoho_synced_at:           (row.zoho_synced_at as string | null) ?? null,
    notes:                    (row.notes as string | null) ?? null,
    receiving_support_notes:  (row.receiving_support_notes as string | null) ?? null,
    receiving_listing_url:    (row.receiving_listing_url as string | null) ?? null,
    // Incoming-view only; null on other views (SELECT omits the columns).
    delivery_state:           (row.delivery_state as string | null) ?? null,
    po_date:                  (row.po_date as string | null) ?? null,
    expected_delivery_date:   (row.expected_delivery_date as string | null) ?? null,
    vendor_name:              (row.vendor_name as string | null) ?? null,
    shipment_has_exception:   row.shipment_has_exception == null ? null : !!row.shipment_has_exception,
    shipment_latest_event_at: (row.shipment_latest_event_at as string | null) ?? null,
    shipment_is_terminal:     row.shipment_is_terminal == null ? null : !!row.shipment_is_terminal,
    receiving_type:            (row.receiving_type as string | null) ?? 'PO',
    created_at:               (row.created_at as string | null) ?? null,
    // Most-recent activity timestamp matching the server's sort order for
    // view=recent/all. Falls through to received_at / created_at so the
    // rail can render a single "last touched" field regardless of view.
    last_activity_at:         (row.last_scan_at as string | null)
                              ?? (row.receiving_received_at as string | null)
                              ?? (row.created_at as string | null)
                              ?? null,
    image_url:                (row.image_url as string | null) ?? null,
    source_platform:          (row.receiving_source_platform as string | null) ?? null,
    /** receiving.source — 'zoho_po' | 'unmatched' | 'local_pickup'. Drives which workspace variant mounts. */
    receiving_source:         (row.receiving_source as string | null) ?? null,
    photo_count:              row.photo_count != null ? Number(row.photo_count) : 0,
    zendesk_ticket:           (row.zendesk_ticket as string | null) ?? null,
  };
}
