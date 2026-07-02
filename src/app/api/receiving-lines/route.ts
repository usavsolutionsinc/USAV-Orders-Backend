import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery, withTenantConnection, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { resolveCurrentReceivingLineIds, type SerialUnitRow } from '@/lib/neon/serial-units-queries';
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
import { parseReceivingView } from '@/lib/receiving/receiving-views';
import { recomputeCartonSourceLink } from '@/lib/receiving/carton-source-link';
import { NOT_ZOHO_RECEIVED_PREDICATE, CARRIER_MISMATCH_PREDICATE, SHIPMENT_SCANNED_PREDICATE } from '@/lib/receiving/delivered-unscanned';
import { isIncomingUniversal } from '@/lib/feature-flags';
import { notInboundMirrorTerminalPredicate } from '@/lib/inbound/mirror';
import { isReceivingPhysicalStateFirst } from '@/lib/feature-flags';
import { sqlReceivingPhotoCount } from '@/lib/photos/queries/receiving-list';
import { UNBOX_OPENED_PREDICATE_SQL } from '@/lib/receiving/unbox-scan-opened';

/**
 * A serial (aliased `alias`) whose CURRENT receiving line — its most recent
 * inventory_events touch, falling back to the frozen origin — is `rl.id`.
 * NOT a plain `alias.origin_receiving_line_id = rl.id` join: that column
 * COALESCE-freezes to the FIRST-ever line, so a returned-then-re-received
 * serial would only ever "find" the PO it originally shipped under, never the
 * one it's actually on now. Mirrors `resolveCurrentReceivingLineIds`
 * (src/lib/neon/serial-units-queries.ts) — same logic, inlined because it
 * composes into a larger dynamic WHERE string rather than running standalone.
 */
function currentLineIsMatchSql(alias: string): string {
  return `COALESCE(
    (SELECT ie.receiving_line_id FROM inventory_events ie
      WHERE ie.serial_unit_id = ${alias}.id AND ie.receiving_line_id IS NOT NULL
        AND ie.organization_id = ${alias}.organization_id
      ORDER BY ie.occurred_at DESC, ie.id DESC LIMIT 1),
    ${alias}.origin_receiving_line_id
  ) = rl.id`;
}

type LineSerial = {
  id: number;
  serial_number: string;
  current_status: string;
  sku_catalog_id: number | null;
  condition_grade: string | null;
  created_at: string;
};

async function fetchSerialsForLines(lineIds: number[], orgId: OrgId): Promise<Map<number, LineSerial[]>> {
  const grouped = new Map<number, LineSerial[]>();
  if (lineIds.length === 0) return grouped;

  // Candidate serials: anything EVER touched by one of these lines — either
  // its frozen origin, or a later inventory_events attach (a return re-
  // received under a different PO moves a serial onto a NEW line without
  // ever updating origin_receiving_line_id). serial_units is org-owned;
  // org-scope so a cross-tenant line id can never surface another tenant's
  // serials.
  const result = await tenantQuery<SerialUnitRow>(
    orgId,
    `SELECT DISTINCT su.id, su.serial_number, su.current_status, su.sku_catalog_id,
            su.condition_grade, su.origin_receiving_line_id, su.created_at
       FROM serial_units su
      WHERE su.organization_id = $2
        AND (su.origin_receiving_line_id = ANY($1::int[])
             OR EXISTS (
               SELECT 1 FROM inventory_events ie
                WHERE ie.serial_unit_id = su.id
                  AND ie.receiving_line_id = ANY($1::int[])
                  AND ie.organization_id = $2
             ))
      ORDER BY su.created_at ASC, su.id ASC`,
    [lineIds, orgId],
  );
  if (result.rows.length === 0) return grouped;

  // Resolve each candidate's CURRENT line (most recent inventory_events touch,
  // falling back to the frozen origin) — never group by origin_receiving_line_id
  // directly, or a re-received serial keeps showing on its first-ever line.
  const currentLines = await resolveCurrentReceivingLineIds(
    result.rows.map((row) => Number(row.id)),
    orgId,
  );

  for (const row of result.rows) {
    const lineId = currentLines.get(Number(row.id)) ?? row.origin_receiving_line_id;
    if (lineId == null || !lineIds.includes(lineId)) continue;
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

// Priority rank for the receiving "Prioritize" views (?sort=priority). Lower
// rank sorts to the top. An explicitly-flagged carton (receiving.is_priority —
// pending-order match or manual toggle) is rank 0 and leads everything. Next, an
// unfound/untagged carton is the most urgent thing to triage (you can't act
// until it's identified); once a platform is tagged the order is amazon → ebay →
// goodwill; everything else trails. The platform half is derived at read time
// from receiving.source_platform, so re-tagging a carton immediately
// re-prioritizes it. References the `r` alias (the LATERAL receiving join in
// every list query below).
// A manual priority_tier override (0..3) wins outright via COALESCE; falls back
// to the legacy is_priority boolean (rank 0), then the platform-derived rank.
const RECEIVING_PRIORITY_RANK_SQL = `
  COALESCE(r.priority_tier, CASE
    WHEN COALESCE(r.is_priority, false) THEN 0
    WHEN r.source = 'unmatched' OR r.source_platform IS NULL THEN 1
    WHEN lower(r.source_platform) = 'amazon'   THEN 2
    WHEN lower(r.source_platform) = 'ebay'     THEN 3
    WHEN lower(r.source_platform) = 'goodwill' THEN 4
    ELSE 9
  END)`;

// Triage priority-lane tier (docs/receiving-triage-redesign-plan.md §4.2) —
// composes with RECEIVING_PRIORITY_RANK_SQL as a SECONDARY tie-breaker, never
// a replacement: `priority_lane` is NULL on every carton that predates Phase 2
// (and on any carton the operator hasn't staged yet), so putting it ahead of
// the primary rank would silently reshuffle the entire live Prioritize tab the
// moment this shipped. Mirrors receivingTriageLanePolicy's lane values
// (src/lib/receiving/triage-lane-policy.ts) — keep in sync if that list changes.
const RECEIVING_LANE_RANK_SQL = `
  CASE r.priority_lane
    WHEN 'PO_STOCKOUT' THEN 0
    WHEN 'RETURN'      THEN 1
    WHEN 'PO_STANDARD' THEN 2
    WHEN 'HOLD'        THEN 3
    ELSE 4
  END`;

function parsePositiveTechId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

// ─── GET ──────────────────────────────────────────────────────────────────────
// ?id=<n>              → single row
// ?receiving_id=<n>    → all lines for a package
// ?limit&offset&search → paginated list (omit receiving_id to get all)
export const GET = withAuth(async (request: NextRequest, ctx) => {
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
    // Sort axis for the receiving-history feed (view=recent/all/activity).
    // Lets the history UI sort by scanned-at (door), unboxed-at, or received-at
    // (the line's terminal DONE / "Received" transition — receiving_lines.
    // received_done_at, distinct from the misnamed door-scan receiving.received_at).
    // `unbox_activity` (the unbox Recent rail) = unboxed_at OR the line's own
    // last write (updated_at) — door re-scans bump neither, so triage scans
    // can't reorder the rail, while a return-paired/just-received line (no
    // unbox stamp yet) still surfaces by its line activity.
    const historySort:
      | 'scanned_newest'
      | 'scanned_oldest'
      | 'unboxed_newest'
      | 'received_newest'
      | 'unbox_activity' =
      sortRaw === 'scanned_oldest'
        ? 'scanned_oldest'
        : sortRaw === 'unboxed_newest'
          ? 'unboxed_newest'
          : sortRaw === 'received_newest'
            ? 'received_newest'
            : sortRaw === 'unbox_activity'
              ? 'unbox_activity'
              : 'scanned_newest';
    // Prioritize views (triage Prioritize tab + unbox Prioritize toggle) request
    // ?sort=priority — order by source-platform rank first, recency second.
    const wantsPrioritySort = sortRaw === 'priority';
    // Shared contract with the client (src/lib/receiving/receiving-views.ts) so
    // the supported view set can't drift between the two ends. `null` = no/
    // unknown view → fall back to week-range scoping below.
    const view = parseReceivingView(viewRaw);
    // view=viewed only: the requesting operator, whose recently-opened lines
    // (receiving_line_views) this feed returns. `viewedParamIdx` is the $N of the
    // staff_id param once pushed, reused by the WHERE / ORDER BY / SELECT below.
    const viewerStaffId = Number(ctx?.staffId);
    let viewedParamIdx = 0;
    // Phase 2 — physical-vs-financial decoupling. The triage SCANNED queue keys
    // on PHYSICAL lifecycle (received_at set, not unboxed), so a box on the dock
    // stays visible even when Zoho already marks the PO received/closed; it just
    // carries a `zoho_status` badge. `?zohoStatus=open` (the "Hide Zoho-received"
    // toggle) re-applies the old hide-terminal filter. When the flag is off the
    // old behaviour (always hide Zoho-received) is preserved. Scoped to scanned —
    // Incoming still clears received POs by design.
    const hideZohoReceived =
      String(searchParams.get('zohoStatus') || '').trim().toLowerCase() === 'open';
    const applyScannedZohoExclusion = !isReceivingPhysicalStateFirst() || hideZohoReceived;
    // view=testing only: scope the recently-tested feed to one staff member.
    const testerId = Number(searchParams.get('tester'));
    const include     = String(searchParams.get('include') || '').trim().toLowerCase();
    const includeSerials = include.split(',').map((s) => s.trim()).includes('serials');

    const orgId = ctx.organizationId as OrgId;

    // Universal Incoming (flag-gated, plan §6): when ON, view=incoming also shows
    // eBay-buyer lines and the ?inbound facet filters by primary source. OFF (the
    // default) = byte-identical Zoho-only path — no eBay rows, no new-column refs.
    const inboundSourceParam = String(searchParams.get('inbound') || '').trim().toLowerCase();
    const incomingLinkParam = String(searchParams.get('link') || '').trim().toLowerCase();
    const universalIncoming = view === 'incoming' ? await isIncomingUniversal(orgId) : false;

    // Single row
    if (Number.isFinite(id) && id > 0) {
      const one = await tenantQuery(
        orgId,
        `SELECT rl.*,
                stn.tracking_number_raw AS receiving_tracking_number,
                r.carrier,
                r.source                     AS receiving_source,
                r.source_platform            AS receiving_source_platform,
                r.intake_type                AS receiving_intake_type,
                COALESCE(r.is_priority, false) AS is_priority,
                r.priority_tier                AS priority_tier,
                r.zoho_purchaseorder_number  AS receiving_zoho_purchaseorder_number,
                r.support_notes              AS receiving_support_notes,
                r.zoho_notes                 AS receiving_zoho_notes,
                r.listing_url                AS receiving_listing_url,
                r.received_at::text          AS receiving_received_at,
                r.unboxed_at::text           AS receiving_unboxed_at,
                r.received_by                AS receiving_received_by,
                r.unboxed_by                 AS receiving_unboxed_by,
                staff_rb.name                AS received_by_name,
                staff_ub.name                AS unboxed_by_name,
                COALESCE(ops_scan.first_scanned_at, scan_first.scanned_at)::text  AS first_scanned_at,
                scan_first.scanned_by        AS first_scanned_by,
                staff_sb.name                AS scanned_by_name,
                -- Last physical scan against this carton. Must match the list
                -- view (view=activity) so the single-line refresh dispatched on
                -- every line-select doesn't clobber the rail's scan-based
                -- "last touched" time with rl.created_at (the import date).
                COALESCE(ops_scan.last_scanned_at, rs_agg.last_scan)::text       AS last_scan_at,
                stn.tracking_number_raw      AS shipment_tracking_number,
                stn.carrier                  AS shipment_carrier,
                stn.latest_status_category   AS shipment_status_category,
                stn.is_delivered             AS shipment_is_delivered,
                stn.delivered_at             AS shipment_delivered_at,
                sc.image_url,
                sc.product_title             AS catalog_product_title,
                -- Zoho item title (canonical SoT). Always preferred for display
                -- over the PO line's listing-style item_name and over the
                -- marketplace catalog title — the Zoho SKU's own title governs.
                (SELECT name FROM items
                  WHERE zoho_item_id = rl.zoho_item_id AND status = 'active'
                  LIMIT 1)                   AS zoho_item_title,
                sc.id                        AS sku_catalog_id,
                ${sqlReceivingPhotoCount('rl.receiving_id', 'rl.organization_id')} AS photo_count
         FROM receiving_lines rl
         -- Soft JOIN: direct FK when set, else PO#-based fallback. Partial
         -- unique index ux_receiving_zoho_po_matched (source='zoho_po') ensures
         -- at most one PO-matched receiving row per PO, so no dedup needed.
         -- D1 wrong-shipment guard: a direct receiving FK, else a PO#-based
         -- fallback. When a line has no FK and its PO has multiple zoho_po
         -- receiving rows, the old ON-clause matched them all (row
         -- multiplication / arbitrary shipment). LATERAL + LIMIT 1 picks exactly
         -- one, deterministically: direct FK wins, else prefer a row that
         -- actually carries a shipment, else the newest.
         LEFT JOIN LATERAL (
           SELECT r.* FROM receiving r
            WHERE r.organization_id = rl.organization_id
              AND (r.id = rl.receiving_id
               OR (rl.receiving_id IS NULL
                   AND r.source = 'zoho_po'
                   AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id))
            ORDER BY (r.id = rl.receiving_id) DESC,
                     (r.shipment_id IS NOT NULL) DESC,
                     r.id DESC
            LIMIT 1
         ) r ON TRUE
         LEFT JOIN LATERAL (
            SELECT MAX(rs.scanned_at) AS last_scan
            FROM receiving_scans rs
            WHERE rs.receiving_id = r.id
         ) rs_agg ON TRUE
         LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
         LEFT JOIN staff staff_rb                ON staff_rb.id = r.received_by
         LEFT JOIN staff staff_ub                ON staff_ub.id = r.unboxed_by
         LEFT JOIN LATERAL (
           SELECT rs.scanned_at, rs.scanned_by
           FROM receiving_scans rs
           WHERE rs.receiving_id = r.id
           ORDER BY rs.scanned_at ASC NULLS LAST, rs.id ASC
           LIMIT 1
         ) scan_first ON TRUE
         LEFT JOIN LATERAL (
           SELECT
             MIN(oe.occurred_at) AS first_scanned_at,
             MAX(oe.occurred_at) AS last_scanned_at
           FROM ops_events oe
           WHERE oe.organization_id = rl.organization_id
             AND oe.entity_type = 'receiving'
             AND oe.entity_id = r.id
             AND oe.event_type = 'TRACKING_SCANNED'
         ) ops_scan ON TRUE
         LEFT JOIN staff staff_sb                ON staff_sb.id = scan_first.scanned_by
         -- sku_catalog join is on the SKU STRING, which collides across tenants;
         -- pin to the line's org so a same-SKU row in another tenant can't leak.
         -- Title-guarded: rl.sku is a Zoho SKU whose numbering collides with the
         -- marketplace catalog (Zoho 00143 Soundbar vs Ecwid 143 UB-20). Attach
         -- the catalog row only when it's the SAME product. Compare against both
         -- the listing-style item_name AND the clean Zoho items.name (canonical)
         -- so noisy listing titles don't false-reject a correct catalog row.
         LEFT JOIN sku_catalog sc                ON sc.sku = rl.sku AND sc.organization_id = rl.organization_id
                                                 AND GREATEST(
                                                       similarity(LOWER(sc.product_title), LOWER(COALESCE(rl.item_name, ''))),
                                                       similarity(LOWER(sc.product_title), LOWER(COALESCE((SELECT name FROM items WHERE zoho_item_id = rl.zoho_item_id AND status = 'active' LIMIT 1), '')))
                                                     ) >= 0.25
         WHERE rl.id = $1 AND rl.organization_id = $2`,
        [id, orgId],
      );
      if (one.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
      }
      const normalized = normalizeRow(one.rows[0]);
      if (includeSerials) {
        const serialsByLine = await fetchSerialsForLines([normalized.id], orgId);
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
      const [rows, pkgRes] = await withTenantConnection(orgId, (client) => Promise.all([
        client.query(
          `SELECT rl.*,
                  stn.tracking_number_raw AS receiving_tracking_number,
                  r.carrier,
                  r.source                     AS receiving_source,
                  r.source_platform            AS receiving_source_platform,
                r.intake_type                AS receiving_intake_type,
                  COALESCE(r.is_priority, false) AS is_priority,
                r.priority_tier                AS priority_tier,
                  r.zoho_purchaseorder_number  AS receiving_zoho_purchaseorder_number,
                  r.support_notes              AS receiving_support_notes,
                  r.zoho_notes                 AS receiving_zoho_notes,
                  r.listing_url                AS receiving_listing_url,
                  r.received_at::text          AS receiving_received_at,
                  -- Carton unbox stamp — REQUIRED. normalizeRow maps row.unboxed_at
                  -- ONLY from receiving_unboxed_at, so omitting it here returned
                  -- unboxed_at:null for every line on this path. The post-receive
                  -- sibling refresh (useReceiveAction) dispatches these rows into
                  -- the unbox rail, whose {...existing, ...updated} merge then
                  -- clobbered the good unboxed_at with null → getUnboxActivityAt
                  -- collapsed → the just-received carton sank below the top-N and
                  -- DISAPPEARED. Mirror the other SELECT branches (view=activity).
                  r.unboxed_at::text           AS receiving_unboxed_at,
                  -- Scan-based "last touched" time, matching view=activity so
                  -- package-sibling refreshes merged into the rail keep the
                  -- correct timestamp (see single-row branch above).
                  rs_agg.last_scan::text       AS last_scan_at,
                  stn.tracking_number_raw      AS shipment_tracking_number,
                  stn.carrier                  AS shipment_carrier,
                  stn.latest_status_category   AS shipment_status_category,
                  stn.is_delivered             AS shipment_is_delivered,
                  stn.delivered_at             AS shipment_delivered_at,
                  sc.image_url,
                  sc.product_title             AS catalog_product_title,
                -- Zoho item title (canonical SoT). Always preferred for display
                -- over the PO line's listing-style item_name and over the
                -- marketplace catalog title — the Zoho SKU's own title governs.
                (SELECT name FROM items
                  WHERE zoho_item_id = rl.zoho_item_id AND status = 'active'
                  LIMIT 1)                   AS zoho_item_title,
                  sc.id                        AS sku_catalog_id,
                  ${sqlReceivingPhotoCount('rl.receiving_id', 'rl.organization_id')} AS photo_count
           FROM receiving_lines rl
           LEFT JOIN receiving r                   ON r.id  = rl.receiving_id AND r.organization_id = rl.organization_id
           LEFT JOIN LATERAL (
              SELECT MAX(rs.scanned_at) AS last_scan
              FROM receiving_scans rs
              WHERE rs.receiving_id = r.id
           ) rs_agg ON TRUE
           LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
           -- sku_catalog SKU-string join pinned to the line's org (cross-tenant SKU collision).
           -- Title-guarded too: only attach when the catalog row is the SAME
           -- product (Zoho/marketplace SKU namespaces collide on the number).
           -- Compare against the listing item_name AND the clean Zoho items.name.
           LEFT JOIN sku_catalog sc                ON sc.sku = rl.sku AND sc.organization_id = rl.organization_id
                                                   AND GREATEST(
                                                         similarity(LOWER(sc.product_title), LOWER(COALESCE(rl.item_name, ''))),
                                                         similarity(LOWER(sc.product_title), LOWER(COALESCE((SELECT name FROM items WHERE zoho_item_id = rl.zoho_item_id AND status = 'active' LIMIT 1), '')))
                                                       ) >= 0.25
           WHERE rl.receiving_id = $1 AND rl.organization_id = $2
           ORDER BY rl.id ASC`,
          [receivingId, orgId],
        ),
        client.query(
          `SELECT received_at::text AS received_at,
                  unboxed_at::text AS unboxed_at,
                  created_at::text AS created_at,
                  return_platform::text AS return_platform,
                  source_platform,
                  COALESCE(is_return, false) AS is_return
           FROM receiving
           WHERE id = $1 AND organization_id = $2
           LIMIT 1`,
          [receivingId, orgId],
        ),
      ]));
      const normalizedRows = rows.rows.map(normalizeRow);
      if (includeSerials) {
        const serialsByLine = await fetchSerialsForLines(normalizedRows.map((r) => r.id), orgId);
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

    // Paginated list — all lines, optionally filtered.
    // org gate FIRST so every dynamic predicate below sits on a tenant-scoped
    // base set (and the shared count query inherits it via the same `where`).
    const conditions: string[] = [];
    const values: unknown[]    = [];
    let idx = 1;

    conditions.push(`rl.organization_id = $${idx++}`);
    values.push(orgId);

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
             OR COALESCE(rl.source_order_id, '') ILIKE $${idx}
             OR COALESCE(r.zoho_purchaseorder_number, '') ILIKE $${idx})`,
          );
          values.push(p);
          idx++;
          break;
        case 'tracking':
          conditions.push(
            `(COALESCE(stn.tracking_number_raw, '') ILIKE $${idx}
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
               WHERE su_hist.organization_id = rl.organization_id
                 AND COALESCE(su_hist.serial_number, '') ILIKE $${idx}
                 AND ${currentLineIsMatchSql('su_hist')}
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
            `COALESCE(rl.source_order_id, '') ILIKE $${patternIdx}`,
            `COALESCE(rl.zoho_item_id, '') ILIKE $${patternIdx}`,
            `COALESCE(r.zoho_purchaseorder_number, '') ILIKE $${patternIdx}`,
            `COALESCE(stn.tracking_number_raw, '') ILIKE $${patternIdx}`,
            `COALESCE(stn.tracking_number_raw, '') ILIKE $${patternIdx}`,
            `COALESCE(stn.tracking_number_normalized, '') ILIKE $${patternIdx}`,
            `EXISTS (
               SELECT 1 FROM serial_units su_all
               WHERE su_all.organization_id = rl.organization_id
                 AND COALESCE(su_all.serial_number, '') ILIKE $${patternIdx}
                 AND ${currentLineIsMatchSql('su_all')}
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
    // Universal staff filter (P1-WORK-02): narrow the carton list to one staff —
    // who received, unboxed, or first-scanned it. Absent = ALL staff (default).
    const staffFilterRaw = String(searchParams.get('staff') || '').trim();
    const staffFilterId = Number(staffFilterRaw);
    if (staffFilterRaw && Number.isFinite(staffFilterId) && staffFilterId > 0) {
      const unboxActorClause =
        view === 'unbox_opened'
          ? ` OR r.unbox_opened_by = $${idx} OR EXISTS (
               SELECT 1 FROM ops_events oe_ub
                WHERE oe_ub.organization_id = r.organization_id
                  AND oe_ub.entity_type = 'receiving'
                  AND oe_ub.entity_id = r.id
                  AND oe_ub.event_type = 'UNBOX_SCAN_OPENED'
                  AND oe_ub.actor_staff_id = $${idx}
             )`
          : '';
      conditions.push(
        `(r.received_by = $${idx} OR r.unboxed_by = $${idx} OR EXISTS (
           SELECT 1 FROM receiving_scans rs_staff
           WHERE rs_staff.receiving_id = r.id AND rs_staff.scanned_by = $${idx}
         )${unboxActorClause})`,
      );
      values.push(staffFilterId);
      idx++;
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
      // Union of recent + received, INCLUDING terminal fails (FAILED/RTV/
      // SCRAP) — "all" is the search/scan-resolution dataset, and excluding
      // failed lines made a tested-failed PO unfindable from the unbox scan
      // bar and History search. Includes NULL workflow_status so legacy rows
      // without a status still appear.
      conditions.push(
        `(rl.workflow_status IS NULL OR rl.workflow_status IN ('EXPECTED','ARRIVED','MATCHED','UNBOXED','AWAITING_TEST','IN_TEST','PASSED','FAILED','RTV','SCRAP','DONE'))`,
      );
    } else if (view === 'activity') {
      // "Activity" = the recent-activity rail feed: items in the UNBOXING
      // pipeline only. A carton merely scanned at the door (workflow MATCHED /
      // ARRIVED with nothing received and no unbox timestamp) is intentionally
      // EXCLUDED — door scans belong only in History, not the rail (the rail
      // drives the unboxing workspace / LineEditPanel). A line qualifies once it
      // has actually been unboxed/received: workflow advanced to UNBOXED or
      // beyond, OR quantity_received > 0, OR its carton has an unboxed_at stamp.
      conditions.push(
        `(
           rl.workflow_status IN ('UNBOXED','AWAITING_TEST','IN_TEST','PASSED','DONE')
           OR COALESCE(rl.quantity_received, 0) > 0
           OR r.unboxed_at IS NOT NULL
         )`,
      );
    } else if (view === 'scanned') {
      // "Scanned" = door-scanned and physically in, but NOT yet unboxed — the
      // triage to-do between the door scan and the unbox step. The inverse of
      // `activity`: the carton has a received_at stamp (someone scanned it in)
      // but no unbox stamp and nothing received on the line yet. A line drops
      // off the instant it's unboxed (unboxed_at set, qty>0, or workflow
      // advances), where it surfaces in the unbox/activity rail instead.
      conditions.push(
        // "Scanned" = physically at the dock. received_at is the intended signal,
        // but the Incoming sync pre-creates a zoho_po receiving row (received_at
        // NULL) for every issued PO, and historically the door scan's upsert hit
        // ON CONFLICT and never stamped it — so keying solely on received_at left
        // the whole Prioritize / unbox Queue empty. The door scan ALWAYS writes a
        // receiving_scans row, so treat an existing scan as proof of arrival too.
        // Self-healing for rows scanned before the upsert was fixed; new scans now
        // stamp received_at directly.
        `(r.received_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM receiving_scans rs_scanned WHERE rs_scanned.receiving_id = r.id))
         AND r.unboxed_at IS NULL
         -- Ops event spine: a carton that's been unboxed must never leak back
         -- into the triage "to unbox" queue even if legacy stamps (unboxed_at /
         -- qty_received / workflow_status) failed to roll up.
         AND NOT EXISTS (
           SELECT 1 FROM ops_events oe_unbox
            WHERE oe_unbox.organization_id = rl.organization_id
              AND oe_unbox.entity_type = 'receiving'
              AND oe_unbox.entity_id = r.id
              AND oe_unbox.event_type = 'UNBOX_CONFIRMED'
         )
         AND COALESCE(rl.quantity_received, 0) = 0
         AND (rl.workflow_status IS NULL
              OR rl.workflow_status IN ('EXPECTED','ARRIVED','MATCHED'))
         -- …and the line has produced NO units. A serial_unit means the carton
         -- was already unboxed/labeled/received at the unit level — but a
         -- unit-level receive doesn't always roll up to the line's
         -- quantity_received / workflow_status / receiving.unboxed_at, so those
         -- alone let an already-unboxed carton leak back into the "to unbox"
         -- queue. Origin-line existence is the authoritative "this was opened"
         -- signal, so exclude it here.
         AND NOT EXISTS (
           SELECT 1 FROM serial_units su_unboxed
            WHERE su_unboxed.origin_receiving_line_id = rl.id
         )
         -- Unbox-surface scans belong in view=unbox_opened only — never triage.
         AND NOT ${UNBOX_OPENED_PREDICATE_SQL}`,
      );
      // Phase 2: only hide Zoho-received POs when the physical-state-first flag
      // is off OR the operator opted in via the "Hide Zoho-received" toggle
      // (?zohoStatus=open). By default a physically-present box stays in the
      // queue with a `zoho_status` badge rather than silently vanishing.
      if (applyScannedZohoExclusion) {
        conditions.push(NOT_ZOHO_RECEIVED_PREDICATE);
      }
    } else if (view === 'unbox_opened') {
      // Unbox sidebar work queue: every carton the operator scanned on the Unbox
      // surface (ops_events UNBOX_SCAN_OPENED), found or unfound, unboxed or not.
      conditions.push(UNBOX_OPENED_PREDICATE_SQL);
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
    } else if (view === 'needs-test') {
      // "Needs-test" = the testing TO-DO feed. A unit qualifies once it is
      // PHYSICALLY received (workflow advanced to UNBOXED/AWAITING_TEST/IN_TEST,
      // or quantity_received > 0) AND flagged needs_test, but has NOT reached a
      // terminal verdict yet (PASSED/DONE/FAILED/RTV/SCRAP drop off — they're
      // done). Ordered newest-received-first below so freshly-unboxed units
      // surface at the top for real-time pickup. When a tester is supplied we
      // scope to that tech's own assignments (assigned_tech_id) so each tech's
      // queue is theirs; unassigned units still show in the all-staff feed.
      conditions.push(
        `rl.needs_test = true
         AND (rl.workflow_status IS NULL
              OR rl.workflow_status NOT IN ('PASSED','DONE','FAILED','RTV','SCRAP'))
         AND (
           rl.workflow_status IN ('UNBOXED','AWAITING_TEST','IN_TEST')
           OR COALESCE(rl.quantity_received, 0) > 0
           OR r.unboxed_at IS NOT NULL
         )`,
      );
      if (Number.isFinite(testerId) && testerId > 0) {
        conditions.push(`rl.assigned_tech_id = $${idx}`);
        values.push(testerId);
        idx++;
      }
    } else if (view === 'viewed') {
      // "Viewed" = lines THIS operator recently opened in the receiving
      // workspace (receiving_line_views, upserted on open). Scoped to one staff;
      // ordered by viewed_at DESC below. Unknown viewer → empty feed.
      if (Number.isFinite(viewerStaffId) && viewerStaffId > 0) {
        viewedParamIdx = idx;
        values.push(viewerStaffId);
        idx++;
        conditions.push(
          `EXISTS (SELECT 1 FROM receiving_line_views v
                    WHERE v.receiving_line_id = rl.id AND v.staff_id = $${viewedParamIdx})`,
        );
      } else {
        conditions.push('FALSE');
      }
    } else if (view === 'incoming') {
      // "Incoming" = on a Zoho PO, vendor has issued it, warehouse hasn't
      // touched it yet. Backed by the /api/cron/zoho/incoming-po-sync delta
      // poller. A row drops off this view the instant the operator scans
      // or marks-received against it (workflow advances past EXPECTED OR
      // quantity_received goes positive). Unmatched cartons stay in their
      // own pill — this view is strictly Zoho-sourced expected work.
      if (!universalIncoming) {
        // Legacy Zoho-only Incoming (unchanged): on a Zoho PO, EXPECTED, untouched.
        conditions.push(
          `rl.workflow_status = 'EXPECTED'
           AND COALESCE(rl.quantity_received, 0) = 0
           AND rl.zoho_purchaseorder_id IS NOT NULL
           -- Hide POs Zoho now reports received/closed/cancelled (mirror status),
           -- so a received order drops off Incoming after a Refresh-Zoho sync.
           AND ${NOT_ZOHO_RECEIVED_PREDICATE}
           -- Honor this view's contract: a row drops off "the instant the operator
           -- scans". A door scan writes receiving_scans against the carton's
           -- receiving row but never advances this Zoho-PO line's workflow_status /
           -- quantity_received (the line's receiving_id is often NULL), so without
           -- this guard a scanned/unboxed box stays stuck in Incoming and renders
           -- as delivery_state='UNKNOWN'. Shipment-anchored so it agrees with the
           -- delivered-unscanned tile count (count === rows).
           AND NOT ${SHIPMENT_SCANNED_PREDICATE}`,
        );
      } else {
        // Universal Incoming (plan §6.1): a line qualifies if it's a Zoho PO not
        // yet received (this INCLUDES eBay→Zoho merged lines, which carry the zoho
        // PO id and are governed by the Zoho mirror), OR an eBay-only buyer line
        // (no zoho PO, governed by the eBay mirror). Same SHIPMENT_SCANNED drop-off.
        conditions.push(
          `rl.workflow_status = 'EXPECTED'
           AND COALESCE(rl.quantity_received, 0) = 0
           AND (
             (rl.zoho_purchaseorder_id IS NOT NULL AND ${NOT_ZOHO_RECEIVED_PREDICATE})
             OR
             (rl.zoho_purchaseorder_id IS NULL
              AND rl.inbound_source_type = 'ebay'
              AND ${notInboundMirrorTerminalPredicate('ebay')})
           )
           AND NOT ${SHIPMENT_SCANNED_PREDICATE}`,
        );
        // ?inbound facet — filter by PRIMARY source (merged lines read as 'ebay').
        if (inboundSourceParam === 'ebay') {
          conditions.push(`rl.inbound_source_type = 'ebay'`);
        } else if (inboundSourceParam === 'zoho') {
          conditions.push(`rl.inbound_source_type IS DISTINCT FROM 'ebay'`);
        }
        // ?link=zoho_pending — eBay lines still awaiting their Zoho PO.
        if (incomingLinkParam === 'zoho_pending') {
          conditions.push(`rl.zoho_purchaseorder_id IS NULL`);
        }
      }

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
           AND NOT ${SHIPMENT_SCANNED_PREDICATE}`,
        );
      } else if (deliveryStateFilter === 'DELIVERED_EMAIL') {
        // Email-driven counterpart to DELIVERED_UNOPENED: an "ORDER DELIVERED"
        // email logged a delivery signal for this PO's order#, and it hasn't
        // been scanned at the dock yet. Same normalized-order# join key the
        // summary's getEmailDeliveredUnscannedCount uses, so list === count.
        conditions.push(
          `EXISTS (
             SELECT 1 FROM email_delivery_signals eds
              WHERE eds.order_number_norm = rl.zoho_purchaseorder_number_norm
                AND eds.organization_id = rl.organization_id
                AND eds.delivered_at > NOW() - interval '30 days'
           )
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
            AND (stn.latest_status_category IS NULL OR stn.latest_status_category = 'UNKNOWN')
            AND NOT ${CARRIER_MISMATCH_PREDICATE}`,
        );
      } else if (deliveryStateFilter === 'CARRIER_MISMATCH') {
        // Carrier/number don't match: no known carrier for the tracking#, or the
        // carrier API has no record of it. Same predicate the CASE above uses.
        conditions.push(CARRIER_MISMATCH_PREDICATE);
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
    let orderBy =
      view === 'incoming'
        ? incomingOrderBy
        : view === 'recent' || view === 'all' || view === 'activity'
          ? (historySort === 'unboxed_newest'
              ? `ORDER BY r.unboxed_at::text DESC NULLS LAST, rl.id DESC`
              : historySort === 'received_newest'
                // "Received" = the line's terminal DONE transition. Not yet-DONE
                // lines have a NULL received_done_at and sort last.
                ? `ORDER BY rl.received_done_at::text DESC NULLS LAST, rl.id DESC`
              : historySort === 'unbox_activity'
                // GREATEST skips NULLs in Postgres, so this is "unbox time or
                // last line write, whichever is later"; created_at backstops
                // rows with neither.
                ? `ORDER BY COALESCE(GREATEST(r.unboxed_at, rl.updated_at)::text, rl.created_at::text) DESC NULLS LAST, rl.id DESC`
              : historySort === 'scanned_oldest'
                ? `ORDER BY COALESCE(scan_first.scanned_at::text, r.received_at::text, rl.created_at::text) ASC, rl.id ASC`
                : `ORDER BY COALESCE(scan_first.scanned_at::text, r.received_at::text, rl.created_at::text) DESC, rl.id DESC`)
          : view === 'scanned'
            // Newest door-scan first — the triage to-do reads like an inbox.
            ? `ORDER BY r.received_at::text DESC NULLS LAST, rl.id DESC`
          : view === 'unbox_opened'
            // Newest Unbox-surface scan first — matches the Unboxed sidebar sort.
            ? `ORDER BY COALESCE(r.unbox_opened_at::text, unbox_open.unbox_opened_at::text, scan_first.scanned_at::text, r.received_at::text, rl.created_at::text) DESC NULLS LAST, rl.id DESC`
          : view === 'testing'
            // Sort the "tested" feed by the SAME verdict time the rail renders
            // (tr_agg.tested_at) so the timeline reads monotonically. Ordering by
            // rl.updated_at instead let a non-test edit (or another tester's
            // verdict) bump a line above items this tester verified more recently.
            ? `ORDER BY tr_agg.tested_at DESC NULLS LAST, rl.id DESC`
            : view === 'needs-test'
              // Newest-received first — the testing to-do reads like an inbox
              // with the freshest units at the top. Unbox time is the truest
              // "just arrived for testing" axis; fall back to the door scan,
              // then the line's own write/create time.
              ? `ORDER BY COALESCE(r.unboxed_at, r.received_at, rl.updated_at, rl.created_at)::text DESC NULLS LAST, rl.id DESC`
            : view === 'viewed'
              // Newest-opened first — your recents read like a back button.
              ? (viewedParamIdx > 0
                  ? `ORDER BY (SELECT v.viewed_at FROM receiving_line_views v WHERE v.receiving_line_id = rl.id AND v.staff_id = $${viewedParamIdx}) DESC NULLS LAST, rl.id DESC`
                  : `ORDER BY rl.id DESC`)
            : view === 'received'
              ? `ORDER BY COALESCE(rl.updated_at::text, rl.created_at::text) DESC, rl.id DESC`
              : `ORDER BY COALESCE(rl.zoho_last_modified_time, rl.created_at::text) DESC, rl.id DESC`;
    // ?sort=priority: source-platform rank first, recency second. Scoped to
    // view=scanned — the feed behind both Prioritize surfaces (triage Prioritize
    // tab + unbox Prioritize toggle). Deliberately NOT applied to activity/all:
    // those append unmatched-carton placeholders and re-sort in JS by recent
    // activity (below), which would silently override the priority order. scanned
    // skips both, so the SQL order is the final order. rs_agg isn't joined for
    // scanned, so the recency tiebreak uses received_at.
    if (wantsPrioritySort && view === 'scanned') {
      orderBy = `ORDER BY ${RECEIVING_PRIORITY_RANK_SQL} ASC, ${RECEIVING_LANE_RANK_SQL} ASC, r.received_at::text DESC NULLS LAST, rl.id DESC`;
    }
    // The lateral aggregate is needed for view=recent and view=all so the
    // most recently paired cartons bubble up. Cheap at this scale.
    const recentScansJoin = view === 'recent' || view === 'all' || view === 'activity' || view === 'unbox_opened'
      ? `LEFT JOIN LATERAL (
            SELECT MAX(rs.scanned_at) AS last_scan
            FROM receiving_scans rs
            WHERE rs.receiving_id = r.id
         ) rs_agg ON TRUE`
      : '';
    const unboxOpenedJoin = view === 'unbox_opened'
      ? `LEFT JOIN LATERAL (
            SELECT MAX(oe_uo.occurred_at) AS unbox_opened_at
            FROM ops_events oe_uo
            WHERE oe_uo.organization_id = r.organization_id
              AND oe_uo.entity_type = 'receiving'
              AND oe_uo.entity_id = r.id
              AND oe_uo.event_type = 'UNBOX_SCAN_OPENED'
         ) unbox_open ON TRUE`
      : '';
    // First-class "opened for unbox" axis for the unbox rail (label + sort). Only
    // joined for view=unbox_opened (see unboxOpenedJoin); the column is the query
    // SoT, the ops_event the legacy fallback — same COALESCE the Overview uses.
    const unboxOpenedSelect = view === 'unbox_opened'
      ? `, COALESCE(r.unbox_opened_at, unbox_open.unbox_opened_at)::text AS unbox_opened_at`
      : '';

    // Fetch extra line rows when `view=all` so merged Zoho-less placeholders
    // can displace the tail of the list after sort (Recent + History share this).
    const lineFetchLimit = view === 'all' ? Math.min(limit + 200, 600) : limit;
    values.push(lineFetchLimit, offset);

    const lastScanSelect = view === 'recent' || view === 'all' || view === 'activity'
      ? `, rs_agg.last_scan::text AS last_scan_at`
      : '';

    // Testing-view verdict rollup: latest verdict time + verdict count per line,
    // scoped to the tester when one is supplied. The feed is sorted by
    // rl.updated_at (the per-verdict line bump), so surfacing tested_at lets the
    // rail render a timestamp that matches that order instead of the unrelated
    // receiving/scan time; tested_count drives the "tested k/N" quantity.
    // testerId is a validated finite integer (>0) so it's safe to inline as a
    // literal — this keeps the count query's positional params unchanged.
    const scopeTester = view === 'testing' && Number.isFinite(testerId) && testerId > 0;
    const testedAggSelect = view === 'testing'
      ? `, tr_agg.tested_at::text AS tested_at, tr_agg.tested_count::int AS tested_count`
      : '';
    // Needs-test (testing to-do) sort axis: surface the same received-time the
    // feed is ordered by so the rail renders "received Xm ago" matching the sort
    // order (mapRow folds needs_test_at into last_activity_at first).
    const needsTestSelect = view === 'needs-test'
      ? `, COALESCE(r.unboxed_at, r.received_at, rl.updated_at, rl.created_at)::text AS needs_test_at`
      : '';
    const testedAggJoin = view === 'testing'
      ? `LEFT JOIN LATERAL (
            SELECT MAX(tr.created_at) AS tested_at, COUNT(*) AS tested_count
            FROM testing_results tr
            WHERE tr.receiving_line_id = rl.id
              ${scopeTester ? `AND tr.tested_by = ${Math.trunc(testerId)}` : ''}
         ) tr_agg ON TRUE`
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
                       AND NOT ${SHIPMENT_SCANNED_PREDICATE}
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
                  WHEN stn.tracking_blocked_reason IS NOT NULL
                       AND COALESCE(stn.is_delivered, false) = false
                    THEN 'TRACKING_UNAVAILABLE'
                  WHEN stn.latest_status_category IN ('IN_TRANSIT','ACCEPTED','LABEL_CREATED')
                    THEN 'IN_TRANSIT'
                  WHEN stn.id IS NULL
                    THEN 'AWAITING_TRACKING'
                  -- Carrier/number don't match: no known carrier for the number,
                  -- or the carrier API has no record of it. Peeled out of
                  -- PENDING_CARRIER (below) because these never self-resolve.
                  WHEN ${CARRIER_MISMATCH_PREDICATE}
                    THEN 'CARRIER_MISMATCH'
                  WHEN stn.latest_status_category IS NULL OR stn.latest_status_category = 'UNKNOWN'
                    THEN 'PENDING_CARRIER'
                  ELSE 'UNKNOWN'
                END AS delivery_state,
                stn.tracking_blocked_reason          AS shipment_blocked_reason,
                stn.has_exception                    AS shipment_has_exception,
                stn.latest_event_at::text            AS shipment_latest_event_at,
                stn.is_terminal                      AS shipment_is_terminal,
                mirror.po_date::text                 AS po_date,
                mirror.expected_delivery_date::text  AS expected_delivery_date,
                mirror.vendor_name::text             AS vendor_name`
        : '';
    // Phase 2: surface the Zoho PO mirror status so the UI can badge a
    // physically-present box whose PO Zoho already marks received/closed
    // (instead of the row silently disappearing). Available wherever the
    // zoho_po_mirror JOIN runs (incoming + scanned + the unbox activity rail).
    // The activity rail needs it so a line whose PO Zoho already received reads
    // "Received" (green) instead of falling back to its local unbox-pipeline
    // workflow_status — see getReceivingStatusDot.
    const needsZohoMirror =
      view === 'incoming' || view === 'scanned' || view === 'activity';
    const zohoStatusSelect = needsZohoMirror ? `, mirror.status AS zoho_status` : '';
    // view=viewed only: surface the viewer's own viewed_at so the rail labels
    // each row with "when you opened it" (mapRow folds it into last_activity_at)
    // instead of the unrelated scan/line time.
    const viewedAtSelect =
      view === 'viewed' && viewedParamIdx > 0
        ? `, (SELECT v.viewed_at FROM receiving_line_views v
               WHERE v.receiving_line_id = rl.id AND v.staff_id = $${viewedParamIdx})::text AS viewed_at`
        : '';
    const incomingExtrasJoin = needsZohoMirror
      ? `LEFT JOIN zoho_po_mirror mirror ON mirror.zoho_purchaseorder_id = rl.zoho_purchaseorder_id`
      : '';
    // Universal Incoming: resolve the buyer/storefront account's human label for
    // the source chip (plan §6.3). rl.platform_account_id is stamped by
    // ingestPurchase on an eBay purchase line; join the org catalog 1:1 to turn
    // it into a display label. Incoming-only; NULL for plain Zoho lines.
    const platformAccountJoin =
      view === 'incoming'
        ? `LEFT JOIN platform_accounts pa_inbound
             ON pa_inbound.id = rl.platform_account_id
            AND pa_inbound.organization_id = rl.organization_id`
        : '';
    const platformAccountSelect =
      view === 'incoming'
        ? `, COALESCE(pa_inbound.label, pa_inbound.integration_scope) AS platform_account_label`
        : '';

    const [rowsRes, countRes] = await withTenantConnection(orgId, (client) => Promise.all([
      client.query(
        `SELECT rl.*,
                stn.tracking_number_raw AS receiving_tracking_number,
                r.carrier,
                r.received_at::text          AS receiving_received_at,
                r.unboxed_at::text           AS receiving_unboxed_at,
                r.received_by                AS receiving_received_by,
                r.unboxed_by                 AS receiving_unboxed_by,
                staff_rb.name                AS received_by_name,
                staff_ub.name                AS unboxed_by_name,
                ${view === 'unbox_opened'
                  ? `COALESCE(r.unbox_opened_at, unbox_open.unbox_opened_at, ops_scan.first_scanned_at, scan_first.scanned_at)::text`
                  : `COALESCE(ops_scan.first_scanned_at, scan_first.scanned_at)::text`}  AS first_scanned_at,
                scan_first.scanned_by        AS first_scanned_by,
                staff_sb.name                AS scanned_by_name,
                r.source                     AS receiving_source,
                r.source_platform            AS receiving_source_platform,
                r.intake_type                AS receiving_intake_type,
                COALESCE(r.is_priority, false) AS is_priority,
                r.priority_tier                AS priority_tier,
                r.zoho_purchaseorder_number  AS receiving_zoho_purchaseorder_number,
                r.support_notes              AS receiving_support_notes,
                r.zoho_notes                 AS receiving_zoho_notes,
                r.listing_url                AS receiving_listing_url,
                stn.tracking_number_raw      AS shipment_tracking_number,
                stn.carrier                  AS shipment_carrier,
                stn.latest_status_category   AS shipment_status_category,
                stn.is_delivered             AS shipment_is_delivered,
                stn.delivered_at             AS shipment_delivered_at,
                sc.image_url,
                sc.product_title             AS catalog_product_title,
                -- Zoho item title (canonical SoT). Always preferred for display
                -- over the PO line's listing-style item_name and over the
                -- marketplace catalog title — the Zoho SKU's own title governs.
                (SELECT name FROM items
                  WHERE zoho_item_id = rl.zoho_item_id AND status = 'active'
                  LIMIT 1)                   AS zoho_item_title,
                sc.id                        AS sku_catalog_id,
                ${sqlReceivingPhotoCount('rl.receiving_id', 'rl.organization_id')} AS photo_count
                ${lastScanSelect}
                ${testedAggSelect}
                ${needsTestSelect}
                ${incomingExtrasSelect}
                ${zohoStatusSelect}
                ${platformAccountSelect}
                ${viewedAtSelect}
                ${unboxOpenedSelect}
         FROM receiving_lines rl
         -- Soft JOIN: direct FK when set, else PO#-based fallback (see note above).
         -- D1 wrong-shipment guard: a direct receiving FK, else a PO#-based
         -- fallback. When a line has no FK and its PO has multiple zoho_po
         -- receiving rows, the old ON-clause matched them all (row
         -- multiplication / arbitrary shipment). LATERAL + LIMIT 1 picks exactly
         -- one, deterministically: direct FK wins, else prefer a row that
         -- actually carries a shipment, else the newest.
         LEFT JOIN LATERAL (
           SELECT r.* FROM receiving r
            WHERE r.organization_id = rl.organization_id
              AND (r.id = rl.receiving_id
               OR (rl.receiving_id IS NULL
                   AND r.source = 'zoho_po'
                   AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id))
            ORDER BY (r.id = rl.receiving_id) DESC,
                     (r.shipment_id IS NOT NULL) DESC,
                     r.id DESC
            LIMIT 1
         ) r ON TRUE
         LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
         -- sku_catalog SKU-string join pinned to the line's org (cross-tenant SKU collision).
         -- Title-guarded too: only attach when the catalog row is the SAME
         -- product (Zoho/marketplace SKU namespaces collide on the number).
         -- Compare against the listing item_name AND the clean Zoho items.name.
         LEFT JOIN sku_catalog sc                ON sc.sku = rl.sku AND sc.organization_id = rl.organization_id
                                                 AND GREATEST(
                                                       similarity(LOWER(sc.product_title), LOWER(COALESCE(rl.item_name, ''))),
                                                       similarity(LOWER(sc.product_title), LOWER(COALESCE((SELECT name FROM items WHERE zoho_item_id = rl.zoho_item_id AND status = 'active' LIMIT 1), '')))
                                                     ) >= 0.25
         LEFT JOIN staff staff_rb                ON staff_rb.id = r.received_by
         LEFT JOIN staff staff_ub                ON staff_ub.id = r.unboxed_by
         LEFT JOIN LATERAL (
           SELECT rs.scanned_at, rs.scanned_by
           FROM receiving_scans rs
           WHERE rs.receiving_id = r.id
           ORDER BY rs.scanned_at ASC NULLS LAST, rs.id ASC
           LIMIT 1
         ) scan_first ON TRUE
         LEFT JOIN LATERAL (
           SELECT
             MIN(oe.occurred_at) AS first_scanned_at,
             MAX(oe.occurred_at) AS last_scanned_at
           FROM ops_events oe
           WHERE oe.organization_id = rl.organization_id
             AND oe.entity_type = 'receiving'
             AND oe.entity_id = r.id
             AND oe.event_type = 'TRACKING_SCANNED'
         ) ops_scan ON TRUE
         LEFT JOIN staff staff_sb                ON staff_sb.id = scan_first.scanned_by
         ${recentScansJoin}
         ${unboxOpenedJoin}
         ${testedAggJoin}
         ${incomingExtrasJoin}
         ${platformAccountJoin}
         ${where}
         ${orderBy}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        values,
      ),
      client.query(
        `SELECT COUNT(*) AS total FROM receiving_lines rl
         -- D1 wrong-shipment guard: a direct receiving FK, else a PO#-based
         -- fallback. When a line has no FK and its PO has multiple zoho_po
         -- receiving rows, the old ON-clause matched them all (row
         -- multiplication / arbitrary shipment). LATERAL + LIMIT 1 picks exactly
         -- one, deterministically: direct FK wins, else prefer a row that
         -- actually carries a shipment, else the newest.
         LEFT JOIN LATERAL (
           SELECT r.* FROM receiving r
            WHERE r.organization_id = rl.organization_id
              AND (r.id = rl.receiving_id
               OR (rl.receiving_id IS NULL
                   AND r.source = 'zoho_po'
                   AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id))
            ORDER BY (r.id = rl.receiving_id) DESC,
                     (r.shipment_id IS NOT NULL) DESC,
                     r.id DESC
            LIMIT 1
         ) r ON TRUE
         LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
         ${incomingExtrasJoin}
         ${where}`,
        values.slice(0, -2),
      ),
    ]));

    let normalizedList = rowsRes.rows.map(normalizeRow);
    let total = Number(countRes.rows[0]?.total ?? 0);
    if (includeSerials) {
      const serialsByLine = await fetchSerialsForLines(normalizedList.map((r) => r.id), orgId);
      for (const row of normalizedList) {
        (row as Record<string, unknown>).serials = serialsByLine.get(row.id) ?? [];
      }
    }

    // Unmatched/unfound cartons live in the `receiving` table with no
    // `receiving_lines` row yet, so they never come back from the main query.
    // Append them as placeholder rows for `all` AND `activity` — a scanned
    // unfound carton has been physically touched, so it belongs in the
    // activity feed that backs both the History table and the recent rail.
    const includeUnmatchedPlaceholders =
      (view === 'all' || view === 'activity') &&
      searchScope !== 'zoho_po' &&
      !receivingHistorySkipsUnmatchedPlaceholders(searchField);

    if (includeUnmatchedPlaceholders) {
      // $1 is reserved for orgId (these placeholder queries run on `receiving`,
      // which is org-owned); the optional search pattern becomes $2.
      const unmatchedSearchVals: unknown[] = [orgId];
      let unmatchedSearchSql = '';
      if (search) {
        unmatchedSearchVals.push(`%${search}%`);
        if (searchField === 'po') {
          unmatchedSearchSql =
            ` AND COALESCE(r.zoho_purchaseorder_number, '') ILIKE $2`;
        } else if (searchField === 'tracking') {
          unmatchedSearchSql = ` AND (
               COALESCE(stn.tracking_number_raw, '') ILIKE $2
            OR COALESCE(stn.tracking_number_raw, '') ILIKE $2
            OR COALESCE(stn.tracking_number_normalized, '') ILIKE $2
          )`;
        } else {
          unmatchedSearchSql = ` AND (
               COALESCE(stn.tracking_number_raw, '') ILIKE $2
            OR COALESCE(stn.tracking_number_raw, '') ILIKE $2
            OR COALESCE(stn.tracking_number_normalized, '') ILIKE $2
            OR COALESCE(r.zoho_purchaseorder_number, '') ILIKE $2
          )`;
        }
      }
      const [unmatchedPkgsRes, unmatchedCntRes] = await withTenantConnection(orgId, (client) => Promise.all([
        client.query(
          `SELECT r.id,
                  stn.tracking_number_raw AS receiving_tracking_number,
                  r.carrier,
                  r.received_at::text          AS receiving_received_at,
                  r.unboxed_at::text           AS receiving_unboxed_at,
                  r.created_at::text           AS created_at,
                  r.support_notes              AS receiving_support_notes,
                  r.zoho_notes                 AS receiving_zoho_notes,
                  r.listing_url                AS receiving_listing_url,
                  r.source_platform            AS receiving_source_platform,
                r.intake_type                AS receiving_intake_type,
                  r.source                     AS receiving_source,
                  COALESCE(r.is_priority, false) AS is_priority,
                r.priority_tier                AS priority_tier,
                  r.zoho_purchaseorder_number  AS receiving_zoho_purchaseorder_number,
                  stn.tracking_number_raw      AS shipment_tracking_number,
                  stn.carrier                  AS shipment_carrier,
                  stn.latest_status_category   AS shipment_status_category,
                  stn.is_delivered             AS shipment_is_delivered,
                  stn.delivered_at::text       AS shipment_delivered_at,
                  COALESCE(ops_scan.first_scanned_at, scan_first.scanned_at)::text  AS first_scanned_at,
                  COALESCE(ops_scan.last_scanned_at, rs_agg.last_scan)::text       AS last_scan_at,
                  COALESCE(r.unbox_opened_at::text, unbox_open.unbox_opened_at::text) AS unbox_opened_at,
                ${sqlReceivingPhotoCount('r.id', 'r.organization_id')} AS photo_count
           FROM receiving r
           LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
           LEFT JOIN LATERAL (
               SELECT rs.scanned_at, rs.scanned_by
               FROM receiving_scans rs
               WHERE rs.receiving_id = r.id
               ORDER BY rs.scanned_at ASC NULLS LAST, rs.id ASC
               LIMIT 1
           ) scan_first ON TRUE
           LEFT JOIN LATERAL (
               SELECT
                 MIN(oe.occurred_at) AS first_scanned_at,
                 MAX(oe.occurred_at) AS last_scanned_at
               FROM ops_events oe
               WHERE oe.organization_id = r.organization_id
                 AND oe.entity_type = 'receiving'
                 AND oe.entity_id = r.id
                 AND oe.event_type = 'TRACKING_SCANNED'
           ) ops_scan ON TRUE
           LEFT JOIN LATERAL (
               SELECT MAX(rs.scanned_at) AS last_scan
               FROM receiving_scans rs
               WHERE rs.receiving_id = r.id
            ) rs_agg ON TRUE
           LEFT JOIN LATERAL (
               SELECT MAX(oe_uo.occurred_at) AS unbox_opened_at
               FROM ops_events oe_uo
               WHERE oe_uo.organization_id = r.organization_id
                 AND oe_uo.entity_type = 'receiving'
                 AND oe_uo.entity_id = r.id
                 AND oe_uo.event_type = 'UNBOX_SCAN_OPENED'
           ) unbox_open ON TRUE
           WHERE r.organization_id = $1
             AND r.source IN ('unmatched', 'local_pickup')
             AND NOT EXISTS (
               SELECT 1 FROM receiving_lines rl
                WHERE rl.receiving_id = r.id
                  AND rl.organization_id = r.organization_id
             )
             ${unmatchedSearchSql}
           ORDER BY COALESCE(rs_agg.last_scan::text, r.received_at::text, r.created_at::text) DESC NULLS LAST,
                    r.id DESC
           LIMIT 150`,
          unmatchedSearchVals,
        ),
        client.query(
          `SELECT COUNT(*)::bigint AS n
             FROM receiving r
             LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
            WHERE r.organization_id = $1
              AND r.source IN ('unmatched', 'local_pickup')
              AND NOT EXISTS (
                SELECT 1 FROM receiving_lines rl
                 WHERE rl.receiving_id = r.id
                   AND rl.organization_id = r.organization_id
              )
              ${unmatchedSearchSql}`,
          unmatchedSearchVals,
        ),
      ]));
      total += Number(unmatchedCntRes.rows[0]?.n ?? 0);
      const placeholderNorm = unmatchedPkgsRes.rows.map((pkg) =>
        normalizeRow(buildUnmatchedEmptyReceivingLine(pkg as Record<string, unknown>)),
      );
      for (const row of placeholderNorm) {
        if (includeSerials) (row as Record<string, unknown>).serials = [];
      }
      // Respect the requested sort axis after the placeholder merge —
      // re-sorting everything by scan-based last_activity_at here let a mere
      // door re-scan (e.g. from triage) bump a carton to the top of the
      // unbox rail.
      normalizedList = [...normalizedList, ...placeholderNorm].sort((a, b) =>
        historySort === 'unboxed_newest'
          ? compareReceivingRowsByUnboxedAt(a, b)
          : historySort === 'unbox_activity'
            ? compareReceivingRowsByUnboxActivity(a, b)
            : compareReceivingRowsByScannedAt(a, b),
      );
      const windowed = normalizedList.slice(offset, offset + limit);
      // Lineless unfound placeholders sort last on unboxed_newest and were
      // silently dropped when the main query already filled the page window.
      if (view === 'activity' && placeholderNorm.length > 0) {
        const windowRcvIds = new Set(
          windowed
            .map((r) => r.receiving_id)
            .filter((id): id is number => id != null && Number.isFinite(id)),
        );
        const missingPlaceholders = placeholderNorm.filter(
          (p) =>
            p.id < 0
            && p.receiving_id != null
            && !windowRcvIds.has(p.receiving_id),
        );
        normalizedList =
          missingPlaceholders.length > 0
            ? [...windowed, ...missingPlaceholders.slice(0, 50)]
            : windowed;
      } else {
        normalizedList = windowed;
      }
    }

    // Lineless cartons opened on the Unbox surface (any source — incl. ghost
    // zoho_po rows after the operator typed a PO#) never appear in the lines
    // query above; append them as placeholders keyed on UNBOX_SCAN_OPENED.
    const includeUnboxOpenedPlaceholders =
      view === 'unbox_opened' &&
      searchScope !== 'zoho_po' &&
      !receivingHistorySkipsUnmatchedPlaceholders(searchField);

    if (includeUnboxOpenedPlaceholders) {
      const unboxSearchVals: unknown[] = [orgId];
      let unboxSearchSql = '';
      if (search) {
        unboxSearchVals.push(`%${search}%`);
        if (searchField === 'po') {
          unboxSearchSql = ` AND COALESCE(r.zoho_purchaseorder_number, '') ILIKE $2`;
        } else if (searchField === 'tracking') {
          unboxSearchSql = ` AND (
               COALESCE(stn.tracking_number_raw, '') ILIKE $2
            OR COALESCE(stn.tracking_number_normalized, '') ILIKE $2
          )`;
        } else {
          unboxSearchSql = ` AND (
               COALESCE(stn.tracking_number_raw, '') ILIKE $2
            OR COALESCE(stn.tracking_number_normalized, '') ILIKE $2
            OR COALESCE(r.zoho_purchaseorder_number, '') ILIKE $2
          )`;
        }
      }
      const [unboxPkgsRes, unboxCntRes] = await withTenantConnection(orgId, (client) => Promise.all([
        client.query(
          `SELECT r.id,
                  stn.tracking_number_raw AS receiving_tracking_number,
                  r.carrier,
                  r.received_at::text          AS receiving_received_at,
                  r.unboxed_at::text           AS receiving_unboxed_at,
                  r.created_at::text           AS created_at,
                  r.support_notes              AS receiving_support_notes,
                  r.zoho_notes                 AS receiving_zoho_notes,
                  r.listing_url                AS receiving_listing_url,
                  r.source_platform            AS receiving_source_platform,
                  r.intake_type                AS receiving_intake_type,
                  r.source                     AS receiving_source,
                  COALESCE(r.is_priority, false) AS is_priority,
                  r.priority_tier                AS priority_tier,
                  r.zoho_purchaseorder_number  AS receiving_zoho_purchaseorder_number,
                  stn.tracking_number_raw      AS shipment_tracking_number,
                  stn.carrier                  AS shipment_carrier,
                  stn.latest_status_category   AS shipment_status_category,
                  stn.is_delivered             AS shipment_is_delivered,
                  stn.delivered_at::text       AS shipment_delivered_at,
                  COALESCE(ops_scan.first_scanned_at, scan_first.scanned_at)::text  AS first_scanned_at,
                  COALESCE(r.unbox_opened_at::text, unbox_open.unbox_opened_at::text) AS unbox_opened_at,
                  ${sqlReceivingPhotoCount('r.id', 'r.organization_id')} AS photo_count
           FROM receiving r
           LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
           LEFT JOIN LATERAL (
               SELECT rs.scanned_at, rs.scanned_by
               FROM receiving_scans rs
               WHERE rs.receiving_id = r.id
               ORDER BY rs.scanned_at ASC NULLS LAST, rs.id ASC
               LIMIT 1
           ) scan_first ON TRUE
           LEFT JOIN LATERAL (
               SELECT
                 MIN(oe.occurred_at) AS first_scanned_at,
                 MAX(oe.occurred_at) AS last_scanned_at
               FROM ops_events oe
               WHERE oe.organization_id = r.organization_id
                 AND oe.entity_type = 'receiving'
                 AND oe.entity_id = r.id
                 AND oe.event_type = 'TRACKING_SCANNED'
           ) ops_scan ON TRUE
           LEFT JOIN LATERAL (
               SELECT MAX(oe_uo.occurred_at) AS unbox_opened_at
               FROM ops_events oe_uo
               WHERE oe_uo.organization_id = r.organization_id
                 AND oe_uo.entity_type = 'receiving'
                 AND oe_uo.entity_id = r.id
                 AND oe_uo.event_type = 'UNBOX_SCAN_OPENED'
           ) unbox_open ON TRUE
           WHERE r.organization_id = $1
             AND ${UNBOX_OPENED_PREDICATE_SQL}
             AND NOT EXISTS (
               SELECT 1 FROM receiving_lines rl
                WHERE rl.receiving_id = r.id
                  AND rl.organization_id = r.organization_id
             )
             ${unboxSearchSql}
           ORDER BY COALESCE(r.unbox_opened_at::text, unbox_open.unbox_opened_at::text, scan_first.scanned_at::text, r.received_at::text, r.created_at::text) DESC NULLS LAST,
                    r.id DESC
           LIMIT 150`,
          unboxSearchVals,
        ),
        client.query(
          `SELECT COUNT(*)::bigint AS n
             FROM receiving r
             LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
            WHERE r.organization_id = $1
              AND ${UNBOX_OPENED_PREDICATE_SQL}
              AND NOT EXISTS (
                SELECT 1 FROM receiving_lines rl
                 WHERE rl.receiving_id = r.id
                   AND rl.organization_id = r.organization_id
              )
              ${unboxSearchSql}`,
          unboxSearchVals,
        ),
      ]));
      total += Number(unboxCntRes.rows[0]?.n ?? 0);
      const unboxPlaceholderNorm = unboxPkgsRes.rows.map((pkg) =>
        normalizeRow(buildUnmatchedEmptyReceivingLine(pkg as Record<string, unknown>)),
      );
      for (const row of unboxPlaceholderNorm) {
        if (includeSerials) (row as Record<string, unknown>).serials = [];
      }
      normalizedList = [...normalizedList, ...unboxPlaceholderNorm].sort((a, b) =>
        compareReceivingRowsByUnboxOpenedAt(a, b),
      );
      const windowed = normalizedList.slice(offset, offset + limit);
      // Lineless unfound opened on the Unbox surface sort after lined rows and
      // were silently dropped when the main query already filled the page window.
      if (unboxPlaceholderNorm.length > 0) {
        const windowRcvIds = new Set(
          windowed
            .map((r) => r.receiving_id)
            .filter((id): id is number => id != null && Number.isFinite(id)),
        );
        const missingPlaceholders = unboxPlaceholderNorm.filter(
          (p) =>
            p.id < 0
            && p.receiving_id != null
            && !windowRcvIds.has(p.receiving_id),
        );
        normalizedList =
          missingPlaceholders.length > 0
            ? [...windowed, ...missingPlaceholders.slice(0, 50)]
            : windowed;
      } else {
        normalizedList = windowed;
      }
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
export const POST = withAuth(async (request: NextRequest, ctx) => {
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

    const orgId = ctx.organizationId as OrgId;
    // receiving_lines.organization_id is NOT NULL with a loud-fail GUC default.
    // Run under the org GUC AND stamp the column explicitly so the insert is
    // attributed to the caller's tenant (never the GUC fallback).
    const result = await withTenantTransaction(orgId, (client) => client.query(
      `INSERT INTO receiving_lines (
        receiving_id, zoho_item_id, zoho_line_item_id, zoho_purchase_receive_id,
        zoho_purchaseorder_id, item_name, sku,
        quantity_received, quantity_expected,
        qa_status, disposition_code, condition_grade, disposition_audit, notes,
        needs_test, assigned_tech_id, organization_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17)
      RETURNING *`,
      [
        receivingId, zohoItemId, zohoLineItemId, zohoPurchaseReceiveId,
        zohoPurchaseOrderId, itemName, sku,
        quantityReceived, quantityExpected,
        qaStatusRaw, dispositionRaw, conditionRaw, JSON.stringify(dispositionAudit), notes,
        needsTest, assignedTechId, orgId,
      ],
    ));

    const lineId = result.rows[0]?.id;
    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({ organizationId: ctx.organizationId, action: 'insert', rowId: String(lineId), source: 'receiving-lines.create' });

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
    const orgId = ctx.organizationId as OrgId;
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
        const existing = await tenantQuery<{ needs_test: boolean | null; assigned_tech_id: number | null }>(
          orgId,
          `SELECT needs_test, assigned_tech_id FROM receiving_lines WHERE id = $1 AND organization_id = $2`,
          [id, orgId],
        );
        if (existing.rows.length === 0) {
          return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
        }
        // Only enforce the tech-assignment guard when needs_test is actually being
        // cleared (true -> false). Re-saving a line that is already needs_test=false
        // is a no-op for this field and must not be blocked.
        const wasNeedsTest = existing.rows[0]?.needs_test !== false;
        if (wasNeedsTest) {
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
      const idParamN = values.length;
      values.push(orgId);
      const orgParamN = values.length;
      const result = await tenantQuery<{ id: number; receiving_id: number | null }>(
        orgId,
        `UPDATE receiving_lines SET ${updates.join(', ')}
          WHERE id = $${idParamN} AND organization_id = $${orgParamN}
          RETURNING id, receiving_id`,
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
        const serials = await tenantQuery<{ id: number }>(
          orgId,
          `SELECT id FROM serial_units WHERE origin_receiving_line_id = $1 AND organization_id = $2`,
          [id, orgId],
        );
        for (const s of serials.rows) {
          // sortSerialUnitToParts is a shared, session-less helper (also called by
          // non-route paths); its signature is intentionally left unchanged.
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
          }, ctx.organizationId)
        : null;
      let receivingIdForLine = updatedRow?.receiving_id ?? null;
      if (receivingIdForLine == null) {
        const existing = await tenantQuery<{ receiving_id: number | null }>(
          orgId,
          `SELECT receiving_id FROM receiving_lines WHERE id = $1 AND organization_id = $2`,
          [id, orgId],
        );
        if (existing.rows.length === 0) {
          return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
        }
        receivingIdForLine = existing.rows[0].receiving_id ?? null;
      }
      if (shipment && receivingIdForLine != null) {
        await tenantQuery(
          orgId,
          `UPDATE receiving SET shipment_id = $1 WHERE id = $2 AND organization_id = $3`,
          [shipment.id, receivingIdForLine, orgId],
        );
      }
    }

    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({ organizationId: ctx.organizationId, action: 'update', rowId: String(id), source: 'receiving-lines.update' });

    // Re-fetch with the shipment JOIN so the response carries the just-attached
    // shipment's tracking/carrier/status fields.
    const fresh = await tenantQuery(
      orgId,
      `SELECT rl.*,
              stn.tracking_number_raw AS receiving_tracking_number,
              r.carrier,
              r.source                     AS receiving_source,
              r.source_platform            AS receiving_source_platform,
                r.intake_type                AS receiving_intake_type,
              COALESCE(r.is_priority, false) AS is_priority,
                r.priority_tier                AS priority_tier,
              r.zoho_purchaseorder_number  AS receiving_zoho_purchaseorder_number,
              r.support_notes              AS receiving_support_notes,
              r.zoho_notes                 AS receiving_zoho_notes,
              r.listing_url                AS receiving_listing_url,
              r.received_at::text          AS receiving_received_at,
              -- Scan-based "last touched" time, matching view=activity so the
              -- post-save dispatchLineUpdated keeps the rail's timestamp intact.
              rs_agg.last_scan::text       AS last_scan_at,
              stn.tracking_number_raw      AS shipment_tracking_number,
              stn.carrier                  AS shipment_carrier,
              stn.latest_status_category   AS shipment_status_category,
              stn.is_delivered             AS shipment_is_delivered,
              stn.delivered_at             AS shipment_delivered_at
         FROM receiving_lines rl
         LEFT JOIN receiving r                   ON r.id  = rl.receiving_id AND r.organization_id = rl.organization_id
         LEFT JOIN LATERAL (
            SELECT MAX(rs.scanned_at) AS last_scan
            FROM receiving_scans rs
            WHERE rs.receiving_id = r.id
         ) rs_agg ON TRUE
         LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
        WHERE rl.id = $1 AND rl.organization_id = $2`,
      [id, orgId],
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
export const DELETE = withAuth(async (request: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId as OrgId;
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get('id');
    // `po_id` (zoho_purchaseorder_id) deletes EVERY receiving_line for that PO
    // — that's one Incoming-table row, which dedupes lines to 1 per PO. The
    // single-`id` path stays for callers that target one specific line.
    const poId = (searchParams.get('po_id') || '').trim();
    // `shipment_id` hard-deletes a shipment-anchored "Delivered · not scanned"
    // box that has no PO and no receiving_lines row — the only way to clear that
    // synthetic Incoming row, since there's nothing in receiving_lines to delete.
    const shipmentIdParam = (searchParams.get('shipment_id') || '').trim();

    if (shipmentIdParam) {
      const sid = Number(shipmentIdParam);
      if (!Number.isFinite(sid) || sid <= 0) {
        return NextResponse.json({ success: false, error: 'Valid shipment_id is required' }, { status: 400 });
      }
      // Guard: this path only clears the delivered-unscanned surface. Refuse a
      // shipment that has dock-scan activity (real receiving) or isn't delivered
      // — those aren't Incoming clutter and must not be hard-deleted here.
      // Tenancy: shipping_tracking_numbers has no organization_id, so org-scope
      // by requiring the shipment to be referenced by a `receiving` carton in
      // THIS org (org-owned). That both anchors the tenant and is the exact box
      // this synthetic Incoming row stands for — a cross-org shipment id 404s.
      // Run the guard + the hard-delete on the SAME tenant connection so the
      // org GUC is set for the whole operation.
      const delResult = await withTenantTransaction(orgId, async (client) => {
        const guard = await client.query(
          `SELECT 1
             FROM shipping_tracking_numbers stn
            WHERE stn.id = $1
              AND stn.is_delivered = true
              AND EXISTS (
                SELECT 1 FROM receiving r3
                 WHERE r3.shipment_id = stn.id
                   AND r3.organization_id = $2
              )
              AND NOT EXISTS (
                SELECT 1 FROM receiving r2
                JOIN receiving_scans rs ON rs.receiving_id = r2.id
                WHERE r2.shipment_id = stn.id
                  AND r2.organization_id = $2
              )
            LIMIT 1`,
          [sid, orgId],
        );
        if (guard.rows.length === 0) {
          return { ok: false as const, status: 409 as const, error: 'Shipment is not a delivered-unscanned box (already scanned, not delivered, or not in this org)' };
        }
        // Hard delete. shipment_tracking_events + fba_tracking_item_allocations
        // cascade; every other reference is ON DELETE SET NULL EXCEPT
        // station_scan_sessions (no ON DELETE clause → RESTRICT), so clear those
        // first. A never-scanned box typically has none.
        await client.query('DELETE FROM station_scan_sessions WHERE shipment_id = $1', [sid]);
        const del = await client.query('DELETE FROM shipping_tracking_numbers WHERE id = $1 RETURNING id', [sid]);
        if (del.rows.length === 0) {
          return { ok: false as const, status: 404 as const, error: 'shipment not found' };
        }
        return { ok: true as const };
      });
      if (!delResult.ok) {
        return NextResponse.json({ success: false, error: delResult.error }, { status: delResult.status });
      }
      await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
      await publishReceivingLogChanged({ organizationId: ctx.organizationId, action: 'delete', rowId: `shipment:${sid}`, source: 'receiving-lines.delete-shipment' });
      return NextResponse.json({ success: true, shipment_id: sid });
    }

    if (poId) {
      const result = await tenantQuery<{ id: number }>(
        orgId,
        `DELETE FROM receiving_lines WHERE zoho_purchaseorder_id = $1 AND organization_id = $2 RETURNING id`,
        [poId, orgId],
      );
      if (result.rows.length === 0) {
        return NextResponse.json(
          { success: false, error: 'No receiving lines found for that PO' },
          { status: 404 },
        );
      }
      await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
      await publishReceivingLogChanged({ organizationId: ctx.organizationId, action: 'delete', rowId: poId, source: 'receiving-lines.delete' });
      return NextResponse.json({ success: true, po_id: poId, deleted: result.rows.length });
    }

    // Bulk: `?ids=1,2,3` deletes the batch in ONE statement. The sidebar
    // edit-mode bulk delete uses this — N parallel single-id requests proved
    // flaky (pool contention dropped a couple of rows per batch). Idempotent:
    // ids already gone are simply absent from `deleted`.
    const idsParam = (searchParams.get('ids') || '').trim();
    if (idsParam) {
      const ids = Array.from(new Set(
        idsParam.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0),
      ));
      if (ids.length === 0) {
        return NextResponse.json(
          { success: false, error: 'ids must be a comma-separated list of positive integers' },
          { status: 400 },
        );
      }
      // Delete + carton-source-link recompute on one tenant connection so the
      // org GUC stays set for the recompute (which reads/writes org-owned
      // receiving / receiving_lines via the passed client). recomputeCartonSourceLink's
      // signature is unchanged — it already accepts an optional `db`.
      const deleted = await withTenantTransaction(orgId, async (client) => {
        const result = await client.query<{ id: number; receiving_id: number | null }>(
          `DELETE FROM receiving_lines WHERE id = ANY($1::int[]) AND organization_id = $2 RETURNING id, receiving_id`,
          [ids, orgId],
        );
        const deletedIds = result.rows.map((r) => Number(r.id));
        const cartons = Array.from(
          new Set(result.rows.map((r) => r.receiving_id).filter((x) => x != null).map(Number)),
        );
        // Re-derive each affected carton's source linkage — removing the last
        // linked line reverts the carton to unmatched (the unlink revert).
        for (const rid of cartons) {
          try { await recomputeCartonSourceLink(rid, client); } catch (err) { console.warn('recomputeCartonSourceLink failed', rid, err); }
        }
        return deletedIds;
      });
      await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
      // Count, not the id list — listeners only refetch on this event, and an
      // unbounded id string risks the broker's message size cap.
      await publishReceivingLogChanged({
        organizationId: ctx.organizationId,
        action: 'delete',
        rowId: `bulk:${deleted.length}`,
        source: 'receiving-lines.delete-bulk',
      });
      return NextResponse.json({ success: true, deleted });
    }

    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Valid id or po_id is required' }, { status: 400 });
    }

    const deletedRow = await withTenantTransaction(orgId, async (client) => {
      const result = await client.query<{ id: number; receiving_id: number | null }>(
        `DELETE FROM receiving_lines WHERE id = $1 AND organization_id = $2 RETURNING id, receiving_id`,
        [id, orgId],
      );
      if (result.rows.length === 0) return null;
      // Re-derive the carton's source linkage — if this was the last line carrying
      // a source order, the carton reverts to unmatched (the unlink revert). Owns
      // the downgrade the general PATCH /api/receiving/[id] refuses. Pass the
      // tenant client so the recompute stays org-scoped under the GUC.
      const deletedReceivingId = result.rows[0]?.receiving_id;
      if (deletedReceivingId != null) {
        try { await recomputeCartonSourceLink(Number(deletedReceivingId), client); }
        catch (err) { console.warn('recomputeCartonSourceLink failed', deletedReceivingId, err); }
      }
      return result.rows[0];
    });
    if (!deletedRow) {
      return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
    }

    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({ organizationId: ctx.organizationId, action: 'delete', rowId: String(id), source: 'receiving-lines.delete' });

    return NextResponse.json({ success: true, id });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to delete receiving line';
    console.error('receiving-lines DELETE failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}, { permission: 'receiving.mark_received' });

/** Label for unmatched cartons that have no `receiving_lines` yet (Recent + History). */
const UNMATCHED_EMPTY_LINE_LABEL = 'Unfound PO';

/**
 * `normalizeRow` input: synthetic line id `-receiving_id`, real `receiving_id`
 * (matches `buildUnmatchedStubRow` in the sidebar).
 */
function buildUnmatchedEmptyReceivingLine(pkg: Record<string, unknown>): Record<string, unknown> {
  const rid = Number(pkg.id);
  // The same line-less placeholder serves both unmatched cartons and finalized
  // local pickup POs (one receiving row per PO, items live in
  // local_pickup_order_items). Honour the real source + label so the history
  // row reads sensibly and the details overlay can branch to the pickup panel.
  const source = String(pkg.receiving_source || 'unmatched');
  const isPickup = source === 'local_pickup';
  // An unfound carton is RECEIVED once it has been unboxed at the dock — for a
  // lineless placeholder the only signal is receiving.unboxed_at (set by the
  // local-receive path in mark-received-po, which is purely local for unfound
  // POs since there is no Zoho PO to reconcile). unboxed → DONE ("RECEIVED"),
  // otherwise ARRIVED ("SCANNED"). See workflow-stages.ts / workflowStatusTableLabel.
  const unboxedAt = pkg.receiving_unboxed_at ?? pkg.unbox_opened_at ?? null;
  return {
    id: -rid,
    receiving_id: rid,
    receiving_tracking_number: pkg.receiving_tracking_number,
    carrier: pkg.carrier,
    receiving_received_at: pkg.receiving_received_at,
    receiving_unboxed_at: unboxedAt,
    receiving_support_notes: pkg.receiving_support_notes ?? null,
    receiving_zoho_notes: pkg.receiving_zoho_notes ?? null,
    receiving_listing_url: pkg.receiving_listing_url ?? null,
    receiving_source: source,
    receiving_source_platform: pkg.receiving_source_platform,
    receiving_zoho_purchaseorder_number: pkg.receiving_zoho_purchaseorder_number,
    shipment_tracking_number: pkg.shipment_tracking_number,
    shipment_carrier: pkg.shipment_carrier,
    shipment_status_category: pkg.shipment_status_category,
    shipment_is_delivered: pkg.shipment_is_delivered,
    shipment_delivered_at: pkg.shipment_delivered_at,
    item_name: isPickup
      ? String(pkg.receiving_tracking_number || 'Local pickup')
      : UNMATCHED_EMPTY_LINE_LABEL,
    sku: null,
    zoho_item_id: null,
    zoho_line_item_id: null,
    zoho_purchase_receive_id: null,
    zoho_purchaseorder_id: null,
    zoho_purchaseorder_number: pkg.receiving_zoho_purchaseorder_number ?? null,
    quantity_received: 0,
    quantity_expected: null,
    qa_status: 'PENDING',
    // Unfound cartons opened on the Unbox surface (unbox_opened_at) or physically
    // unboxed at the dock (unboxed_at) read as DONE ("RECEIVED") locally.
    workflow_status: unboxedAt ? 'DONE' : 'ARRIVED',
    disposition_code: 'HOLD',
    condition_grade: 'BRAND_NEW',
    disposition_audit: [],
    needs_test: true,
    is_priority: !!pkg.is_priority,
    priority_tier: pkg.priority_tier ?? null,
    assigned_tech_id: null,
    zoho_sync_source: null,
    zoho_last_modified_time: null,
    zoho_synced_at: null,
    notes: null,
    zoho_notes: null,
    unit_price: null,
    receiving_type: 'PO',
    created_at: pkg.created_at,
    first_scanned_at: pkg.unbox_opened_at ?? pkg.first_scanned_at,
    unbox_opened_at: pkg.unbox_opened_at ?? null,
    last_scan_at: pkg.last_scan_at,
    image_url: null,
    photo_count: pkg.photo_count,
    zoho_reference_number: null,
  };
}

function receivingRowScannedTs(row: {
  scanned_at?: string | null;
  received_at?: string | null;
  created_at?: string | null;
}) {
  const raw = row.scanned_at ?? row.received_at ?? row.created_at ?? null;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function compareReceivingRowsByScannedAt(
  a: { scanned_at?: string | null; received_at?: string | null; created_at?: string | null; id: number },
  b: { scanned_at?: string | null; received_at?: string | null; created_at?: string | null; id: number },
) {
  const d = receivingRowScannedTs(b) - receivingRowScannedTs(a);
  return d !== 0 ? d : b.id - a.id;
}

/** `view=unbox_opened` placeholder merge — newest Unbox-surface scan first. */
function compareReceivingRowsByUnboxOpenedAt(
  a: { scanned_at?: string | null; received_at?: string | null; created_at?: string | null; id: number },
  b: { scanned_at?: string | null; received_at?: string | null; created_at?: string | null; id: number },
) {
  return compareReceivingRowsByScannedAt(a, b);
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

/**
 * `?sort=unboxed_newest` comparator for the placeholder merge. Most recently
 * unboxed first; never-unboxed rows (ts 0 — incl. unfound placeholders) sort
 * last, tie-broken by recent activity so the un-unboxed tail stays stable.
 */
function receivingRowUnboxedTs(row: { unboxed_at?: string | null }) {
  const raw = row.unboxed_at ?? null;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function compareReceivingRowsByUnboxedAt(
  a: { unboxed_at?: string | null; scanned_at?: string | null; received_at?: string | null; created_at?: string | null; id: number },
  b: { unboxed_at?: string | null; scanned_at?: string | null; received_at?: string | null; created_at?: string | null; id: number },
) {
  const d = receivingRowUnboxedTs(b) - receivingRowUnboxedTs(a);
  return d !== 0 ? d : compareReceivingRowsByScannedAt(a, b);
}

/**
 * `?sort=unbox_activity` comparator — JS mirror of the SQL
 * `GREATEST(r.unboxed_at, rl.updated_at)` axis, so the placeholder merge
 * preserves the order. Unfound placeholders carry neither stamp and fall
 * through to scan-based recent activity, which is correct for them (they
 * only exist while physically present and untriaged).
 */
function receivingRowUnboxActivityTs(row: {
  unboxed_at?: string | null;
  updated_at?: string | null;
}) {
  const candidates = [row.unboxed_at, row.updated_at]
    .map((raw) => (raw ? new Date(raw).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  return candidates.length > 0 ? Math.max(...candidates) : 0;
}

function compareReceivingRowsByUnboxActivity(
  a: { unboxed_at?: string | null; updated_at?: string | null; last_activity_at?: string | null; created_at?: string | null; id: number },
  b: { unboxed_at?: string | null; updated_at?: string | null; last_activity_at?: string | null; created_at?: string | null; id: number },
) {
  const d = receivingRowUnboxActivityTs(b) - receivingRowUnboxActivityTs(a);
  return d !== 0 ? d : compareReceivingRowsByRecentActivity(a, b);
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
    // Canonical Zoho catalog title (sku_catalog.product_title), joined by SKU.
    // Prefer this over item_name for display — item_name is the PO/platform
    // line name (eBay etc.) and varies by source. Null when the SKU isn't in
    // the catalog yet; callers fall back to item_name.
    catalog_product_title:    (row.catalog_product_title as string | null) ?? null,
    zoho_item_title:          (row.zoho_item_title as string | null) ?? null,
    // Canonical sku_catalog.id for this line's SKU (joined). Keys the SKU
    // pairing surface; null when the SKU isn't catalogued yet.
    sku_catalog_id:           row.sku_catalog_id != null ? Number(row.sku_catalog_id) : null,
    sku:                      (row.sku as string | null) ?? null,
    quantity_received:        Number(row.quantity_received ?? 0),
    quantity_expected:        row.quantity_expected != null ? Number(row.quantity_expected) : null,
    qa_status:                (row.qa_status as string) ?? 'PENDING',
    workflow_status:          (row.workflow_status as string | null) ?? null,
    disposition_code:         (row.disposition_code as string) ?? 'HOLD',
    condition_grade:          (row.condition_grade as string) ?? 'USED_A',
    disposition_audit:        (row.disposition_audit as unknown[]) ?? [],
    needs_test:               !!row.needs_test,
    is_priority:              !!row.is_priority,
    priority_tier:            row.priority_tier != null ? Number(row.priority_tier) : null,
    assigned_tech_id:         row.assigned_tech_id != null ? Number(row.assigned_tech_id) : null,
    zoho_sync_source:         (row.zoho_sync_source as string | null) ?? null,
    zoho_last_modified_time:  (row.zoho_last_modified_time as string | null) ?? null,
    zoho_synced_at:           (row.zoho_synced_at as string | null) ?? null,
    notes:                    (row.notes as string | null) ?? null,
    zoho_notes:               (row.zoho_notes as string | null) ?? null,
    unit_price:               (row.unit_price as string | null) ?? null,
    receiving_support_notes:  (row.receiving_support_notes as string | null) ?? null,
    receiving_zoho_notes:     (row.receiving_zoho_notes as string | null) ?? null,
    receiving_listing_url:    (row.receiving_listing_url as string | null) ?? null,
    // Incoming-view only; null on other views (SELECT omits the columns).
    delivery_state:           (row.delivery_state as string | null) ?? null,
    po_date:                  (row.po_date as string | null) ?? null,
    expected_delivery_date:   (row.expected_delivery_date as string | null) ?? null,
    vendor_name:              (row.vendor_name as string | null) ?? null,
    // Universal Incoming purchase identity (spine cache cols via rl.*, plan §6.3).
    // inbound_source_type badges the row's source ('zoho' | 'ebay' | …);
    // source_order_id is the external order id (the eBay order#) when there's no
    // Zoho PO; platform_account_* name the buyer account it was purchased on.
    inbound_source_type:      (row.inbound_source_type as string | null) ?? null,
    source_order_id:          (row.source_order_id as string | null) ?? null,
    platform_account_id:      row.platform_account_id != null ? Number(row.platform_account_id) : null,
    platform_account_label:   (row.platform_account_label as string | null) ?? null,
    shipment_has_exception:   row.shipment_has_exception == null ? null : !!row.shipment_has_exception,
    shipment_latest_event_at: (row.shipment_latest_event_at as string | null) ?? null,
    shipment_is_terminal:     row.shipment_is_terminal == null ? null : !!row.shipment_is_terminal,
    receiving_type:            (row.receiving_type as string | null) ?? 'PO',
    // Per-line unfound intake classification (override grain; null on Zoho lines).
    intake_type:               (row.intake_type as string | null) ?? null,
    // Carton-level default receiving type (receiving.intake_type). The carton
    // pill edits this; receiving_type above overrides per line. Migration 2026-06-13b.
    carton_intake_type:        (row.receiving_intake_type as string | null) ?? null,
    // Door-scan vs unbox split (history columns). received_at/scanned_at are the
    // "arrived at the door" event; unboxed_at is when items were extracted.
    // *_by_name resolve the staff who performed each (null on views that omit
    // the joins / unmatched stubs).
    received_at:              (row.receiving_received_at as string | null) ?? null,
    received_by_name:         (row.received_by_name as string | null) ?? null,
    // Terminal "Received" (DONE) transition time — distinct from the door-scan
    // received_at above. Drives History's "Received" sort axis.
    received_done_at:         (row.received_done_at as string | null) ?? null,
    unboxed_at:               (row.receiving_unboxed_at as string | null) ?? null,
    unboxed_by_name:          (row.unboxed_by_name as string | null) ?? null,
    scanned_at:               (row.first_scanned_at as string | null) ?? null,
    scanned_by_name:          (row.scanned_by_name as string | null) ?? null,
    // First-class "opened for unbox" time (receiving.unbox_opened_at / UNBOX_SCAN_OPENED).
    // The unbox rail reads THIS for its label + sort — same axis as the Overview —
    // instead of inferring it from the overloaded scanned_at. Null on non-unbox views.
    unbox_opened_at:          (row.unbox_opened_at as string | null) ?? null,
    created_at:               (row.created_at as string | null) ?? null,
    // Last write to the line itself (qty bump, condition, notes, …). Drives
    // the unbox_activity sort's tiebreak in the placeholder merge.
    updated_at:               (row.updated_at as string | null) ?? null,
    // Most-recent activity timestamp matching the server's sort order. For
    // view=testing this leads with tested_at (the verdict time the feed is
    // ordered by); for view=recent/all it's the last scan. Falls through to
    // received_at / created_at so the rail can render a single "last touched"
    // field regardless of view.
    last_activity_at:         (row.viewed_at as string | null)
                              ?? (row.tested_at as string | null)
                              ?? (row.needs_test_at as string | null)
                              ?? (row.last_scan_at as string | null)
                              ?? (row.receiving_received_at as string | null)
                              ?? (row.created_at as string | null)
                              ?? null,
    // Recorded testing verdicts for this line (view=testing only; null elsewhere).
    // Scoped to the tester when the feed is. Drives the rail's "tested k/N".
    tested_count:             row.tested_count != null ? Number(row.tested_count) : null,
    image_url:                (row.image_url as string | null) ?? null,
    source_platform:          (row.receiving_source_platform as string | null) ?? null,
    /** receiving.source — 'zoho_po' | 'unmatched' | 'local_pickup'. Drives which workspace variant mounts. */
    receiving_source:         (row.receiving_source as string | null) ?? null,
    photo_count:              row.photo_count != null ? Number(row.photo_count) : 0,
    zendesk_ticket:           (row.zendesk_ticket as string | null) ?? null,
  };
}
