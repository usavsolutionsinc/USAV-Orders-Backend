import { after } from 'next/server';
import pool from '@/lib/db';
import {
  createCacheLookupKey,
  getCachedJson,
  setCachedJson,
} from '@/lib/cache/upstash-cache';
import { getCurrentPSTDateKey } from '@/utils/date';
import { queryWithRetry } from '@/lib/db-retry';
import { isPackerLogEnrichmentRead } from '@/lib/feature-flags';
import type { OrgId } from '@/lib/tenancy/constants';

export type PackerLogsTrackingFilter = 'all' | 'orders' | 'sku' | 'fba';

export interface FetchPackerLogRowsOptions {
  /**
   * Tenant scope (REQUIRED). Every row is filtered by `sal.organization_id`
   * and the org id is part of the cache key — without it this loader returned
   * every tenant's PACK rows to any caller (tenant-isolation bug, 2026-07-01).
   */
  organizationId: OrgId;
  packerId?: number | null;
  testedBy?: number | null;
  /**
   * Universal staff filter (P1-WORK-02): narrow to rows this staff packed OR
   * tested. Null/absent = ALL staff (default). Independent of packerId/testedBy.
   */
  staffId?: number | null;
  limit?: number;
  offset?: number;
  weekStart?: string;
  weekEnd?: string;
  trackingTypeFilter?: PackerLogsTrackingFilter;
}

export interface FetchPackerLogRowsResult {
  rows: any[];
  cacheTTL: number;
  cacheHit: boolean;
}

// v6: adds ship_confirmed_at / shipped_out_by / shipped_out_by_name (dock scan-out).
const CACHE_NAMESPACE = 'api:packing-logs-v6';
const CACHE_TAGS = ['packing-logs'];

/**
 * Shared loader for the /tech packer-logs week query. Lives in its own module so
 * the /api/packerlogs route and the /packer server-component prefetch can share
 * one code path (one cache key, one SQL string).
 *
 * Behavior intentionally mirrors the original inline route logic:
 *   • Same cache namespace/key shape (createCacheLookupKey + 'api:packing-logs-v5')
 *   • Same TTL rules (120s current/this-week, 86400s closed past weeks)
 *   • Same `tracking_type` filter semantics and SQL string
 *   • Cache write is deferred via `after()` so it never blocks TTFB
 */
export async function fetchPackerLogRows(
  opts: FetchPackerLogRowsOptions,
): Promise<FetchPackerLogRowsResult> {
  const limit = opts.limit ?? 500;
  const offset = opts.offset ?? 0;
  const weekStart = opts.weekStart ?? '';
  const weekEnd = opts.weekEnd ?? '';
  const trackingTypeFilter: PackerLogsTrackingFilter = opts.trackingTypeFilter ?? 'all';

  const orgId = opts.organizationId;

  const staffFilterId =
    opts.staffId != null && Number.isFinite(opts.staffId) && opts.staffId > 0 ? opts.staffId : null;

  const cacheLookup = createCacheLookupKey({
    // Org id FIRST so the cache is per-tenant — never share a PACK-log page
    // across organizations.
    organizationId: orgId,
    packerId: opts.packerId ?? '',
    testedBy: opts.testedBy ?? '',
    staffId: staffFilterId ?? '',
    limit,
    offset,
    weekStart,
    weekEnd,
    trackingTypeFilter,
  });

  const today = getCurrentPSTDateKey();
  const cacheTTL = weekEnd && weekEnd < today ? 86400 : 120;

  const cached = await getCachedJson<any[]>(CACHE_NAMESPACE, cacheLookup);
  if (cached) {
    return { rows: cached, cacheTTL, cacheHit: true };
  }

  const params: any[] = [];
  const conditions: string[] = [`sal.station = 'PACK'`];

  // Tenant scope — bounds the whole page CTE (and therefore both the legacy and
  // enriched queries, which share these conditions) to the caller's org.
  params.push(orgId);
  conditions.push(`sal.organization_id = $${params.length}`);

  if (opts.packerId != null && !Number.isNaN(opts.packerId)) {
    params.push(opts.packerId);
    conditions.push(`sal.staff_id = $${params.length}`);
  }

  if (opts.testedBy != null && !Number.isNaN(opts.testedBy)) {
    params.push(opts.testedBy);
    const testedByIdx = params.length;
    conditions.push(`(test_data.tested_by = $${testedByIdx} OR wa_t.assigned_tech_id = $${testedByIdx})`);
  }

  // Universal staff filter: this person packed OR tested the row. References the
  // order-derived test laterals, so it forces the page-filter joins on (below).
  if (staffFilterId != null) {
    params.push(staffFilterId);
    const staffIdx = params.length;
    conditions.push(
      `(sal.staff_id = $${staffIdx}`
      + ` OR test_data.tested_by = $${staffIdx}`
      + ` OR wa_t.assigned_tech_id = $${staffIdx})`,
    );
  }

  if (weekStart && weekEnd) {
    params.push(weekStart, weekEnd);
    const ws = params.length - 1;
    const we = params.length;
    conditions.push(`sal.created_at >= ($${ws}::date - interval '1 day')`);
    conditions.push(`sal.created_at <  ($${we}::date + interval '2 days')`);
  }

  if (trackingTypeFilter === 'fba') {
    conditions.push(
      `(COALESCE(pl.tracking_type, '') IN ('FBA', 'FNSKU')`
      + ` OR sal.activity_type = 'FBA_READY'`
      + ` OR COALESCE(sal.scan_ref, '') ~* '^FBA[0-9A-Z]{8,}$')`,
    );
  } else if (trackingTypeFilter === 'orders') {
    conditions.push(
      `(COALESCE(pl.tracking_type, 'ORDERS') = 'ORDERS'`
      + ` AND COALESCE(sal.scan_ref, '') !~* '^FBA[0-9A-Z]{8,}$'`
      + ` AND sal.activity_type != 'FBA_READY')`,
    );
  } else if (trackingTypeFilter === 'sku') {
    conditions.push(`COALESCE(pl.tracking_type, '') = 'SKU'`);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  params.push(limit, offset);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  // Page-selection joins. Almost every filter touches only sal/pl, but a
  // testedBy filter references the order-derived laterals — so pull those into
  // the page query only when testedBy is active (keeps the common path minimal).
  const pageFilterJoins = (opts.testedBy != null && !Number.isNaN(opts.testedBy)) || staffFilterId != null
    ? `
        LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
        LEFT JOIN LATERAL (
            SELECT ord.id
            FROM orders ord
            LEFT JOIN shipment_links osl ON osl.owner_id = ord.id AND osl.owner_type = 'ORDER'
            LEFT JOIN shipping_tracking_numbers ord_stn ON ord_stn.id = ord.shipment_id
            WHERE (
                sal.shipment_id IS NOT NULL
                AND (
                  osl.shipment_id = sal.shipment_id
                  OR ord.shipment_id = sal.shipment_id
                )
            ) OR (
                COALESCE(stn.tracking_number_raw, sal.scan_ref, '') <> ''
                AND ord_stn.tracking_number_raw IS NOT NULL
                AND ord_stn.tracking_number_raw != ''
                AND RIGHT(regexp_replace(UPPER(ord_stn.tracking_number_raw), '[^A-Z0-9]', '', 'g'), 18) =
                    RIGHT(regexp_replace(UPPER(COALESCE(stn.tracking_number_raw, sal.scan_ref, '')), '[^A-Z0-9]', '', 'g'), 18)
            )
            ORDER BY
                CASE
                  WHEN sal.shipment_id IS NOT NULL AND osl.shipment_id = sal.shipment_id THEN 0
                  WHEN sal.shipment_id IS NOT NULL AND ord.shipment_id = sal.shipment_id THEN 1
                  ELSE 2
                END,
                CASE WHEN COALESCE(osl.is_primary, false) THEN 0 ELSE 1 END,
                ord.created_at DESC NULLS LAST,
                ord.id DESC
            LIMIT 1
        ) order_match ON TRUE
        LEFT JOIN orders o ON o.id = order_match.id AND o.organization_id = sal.organization_id
        LEFT JOIN LATERAL (
            SELECT wa.assigned_tech_id
            FROM work_assignments wa
            WHERE wa.entity_type = 'ORDER'
              AND wa.entity_id = o.id
              AND wa.work_type = 'TEST'
              AND wa.status IN ('ASSIGNED', 'IN_PROGRESS')
            ORDER BY wa.created_at DESC, wa.id DESC
            LIMIT 1
        ) wa_t ON TRUE
        LEFT JOIN LATERAL (
            SELECT MIN(tsn.tested_by)::int AS tested_by
            FROM tech_serial_numbers tsn
            WHERE o.shipment_id IS NOT NULL
              AND tsn.shipment_id = o.shipment_id
        ) test_data ON TRUE`
    : '';

  // Resolve the page of station_activity_logs rows BEFORE the expensive per-row
  // product-title / serial / order-match laterals run. Previously LIMIT was
  // applied last, so Postgres evaluated every lateral for ALL PACK rows in
  // history (thousands, unbounded growth) and only then kept 50 — ~20s/request.
  // Selecting the page first caps the heavy work at `limit` rows (~350ms).
  const pageCte = `
    WITH page AS MATERIALIZED (
        SELECT sal.id
        FROM station_activity_logs sal
        LEFT JOIN packer_logs pl ON pl.id = sal.packer_log_id${pageFilterJoins}
        ${whereClause}
        ORDER BY sal.created_at DESC NULLS LAST
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
    )`;

  const legacyQuery = `
    ${pageCte}
    SELECT
        sal.id,
        sal.packer_log_id AS packer_log_id,
        to_char(sal.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
        sal.scan_ref,
        COALESCE(stn.tracking_number_raw, oe.shipping_tracking_number, sal.scan_ref, sal.fnsku) AS shipping_tracking_number,
        oe.id AS orders_exception_id,
        oe.exception_reason,
        oe.status AS exception_status,
        CASE WHEN oe.id IS NOT NULL AND o.id IS NULL THEN 'exception' ELSE 'order' END AS row_source,
        sal.staff_id AS packed_by,
        packed_staff.name AS packed_by_name,
        COALESCE(pl.tracking_type,
                 CASE sal.activity_type
                   WHEN 'FBA_READY' THEN 'FNSKU'
                   WHEN 'PACK_COMPLETED' THEN 'ORDERS'
                   ELSE 'SCAN'
                 END) AS tracking_type,
        NULL::json AS packer_photos_url,
        o.id AS order_row_id,
        o.shipment_id,
        o.order_id,
        COALESCE(o.account_source, CASE WHEN sal.fnsku IS NOT NULL THEN 'fba' ELSE null END) AS account_source,
        COALESCE(order_trackings.tracking_numbers, '[]'::json) AS tracking_numbers,
        COALESCE(order_trackings.tracking_number_rows, '[]'::json) AS tracking_number_rows,
        COALESCE(
            ff.product_title,
            o.product_title,
            ecwid_lookup.ecwid_product_title,
            sku_catalog_lookup.catalog_product_title,
            sku_stock_lookup.stock_product_title,
            NULLIF(BTRIM(o.item_number), ''),
            NULLIF(BTRIM(o.sku), '')
        ) AS product_title,
        to_char(wa_deadline.deadline_at, 'YYYY-MM-DD HH24:MI:SS') AS ship_by_date,
        to_char(wa_deadline.deadline_at, 'YYYY-MM-DD HH24:MI:SS') AS deadline_at,
        o.item_number,
        NULLIF(TRIM(COALESCE(o.condition, '')), '') AS condition,
        COALESCE(o.quantity, sal.metadata->>'quantity') AS quantity,
        COALESCE(
            o.sku,
            ff.sku,
            sal.metadata->>'sku',
            CASE WHEN POSITION(':' IN COALESCE(sal.scan_ref, '')) > 0
                 THEN TRIM(split_part(sal.scan_ref, ':', 1))
                 ELSE NULL
            END
        ) AS sku,
        COALESCE(o.notes, '') AS notes,
        COALESCE(o.status_history, '[]'::jsonb) AS status_history,
        COALESCE(
            NULLIF(TRIM(COALESCE(test_data.serial_number, '')), ''),
            NULLIF(TRIM(COALESCE(sku_lookup.sku_table_serial, '')), '')
        ) AS serial_number,
        sku_lookup.sku_table_id AS sku_table_id,
        wa_t.assigned_tech_id AS tester_id,
        test_data.tested_by,
        test_data.test_date_time,
        tested_staff.name AS tested_by_name,
        tester_staff.name AS tester_name,
        sal.fnsku,
        (NULLIF(TRIM(sal.metadata->>'fnsku_log_id'), ''))::bigint AS fnsku_log_id,
        stn.carrier                            AS carrier,
        stn.latest_status_code                 AS latest_status_code,
        stn.latest_status_label                AS latest_status_label,
        stn.latest_status_description          AS latest_status_description,
        stn.latest_status_category             AS latest_status_category,
        stn.latest_event_at::text              AS latest_event_at,
        stn.has_exception                      AS has_exception,
        stn.exception_at::text                 AS exception_at,
        stn.is_terminal                        AS is_terminal,
        to_char(ship_out.ship_confirmed_at, 'YYYY-MM-DD HH24:MI:SS') AS ship_confirmed_at,
        ship_out.shipped_out_by                AS shipped_out_by,
        shipped_out_staff.name                 AS shipped_out_by_name
    FROM station_activity_logs sal
    JOIN page ON page.id = sal.id
    LEFT JOIN packer_logs pl ON pl.id = sal.packer_log_id
    LEFT JOIN LATERAL (
        SELECT
            sk.id AS sku_table_id,
            sk.serial_number AS sku_table_serial,
            sk.static_sku AS sku_table_static_sku
        FROM v_sku sk
        WHERE sk.static_sku IS NOT NULL AND BTRIM(sk.static_sku) <> ''
          AND (
              (sal.shipment_id IS NOT NULL AND sk.shipment_id = sal.shipment_id)
              OR BTRIM(sk.static_sku) = BTRIM(COALESCE(sal.scan_ref, ''))
              OR (
                NULLIF(TRIM(sal.metadata->>'sku'), '') IS NOT NULL
                AND BTRIM(sk.static_sku) = BTRIM(sal.metadata->>'sku')
              )
              OR (
                POSITION(':' IN COALESCE(sal.scan_ref, '')) > 0
                AND (
                    BTRIM(sk.static_sku) = BTRIM(split_part(sal.scan_ref, ':', 1))
                    OR BTRIM(sk.static_sku) = BTRIM(sal.scan_ref)
                    OR regexp_replace(UPPER(TRIM(COALESCE(sk.static_sku, ''))), '^0+', '') =
                       regexp_replace(UPPER(TRIM(split_part(sal.scan_ref, ':', 1))), '^0+', '')
                )
              )
          )
        ORDER BY
          CASE WHEN sal.shipment_id IS NOT NULL AND sk.shipment_id = sal.shipment_id THEN 0 ELSE 1 END,
          sk.updated_at DESC NULLS LAST,
          sk.id DESC
        LIMIT 1
    ) sku_lookup ON TRUE
    LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
    -- Dock scan-out (SHIP_CONFIRM) for this package's shipment, if any. Bounded:
    -- runs once per page row. This is the "left the warehouse" timestamp.
    LEFT JOIN LATERAL (
        SELECT
            MAX(so.created_at) AS ship_confirmed_at,
            (ARRAY_AGG(so.staff_id ORDER BY so.created_at DESC))[1] AS shipped_out_by
        FROM station_activity_logs so
        WHERE so.activity_type = 'SHIP_CONFIRM'
          AND sal.shipment_id IS NOT NULL
          AND so.shipment_id = sal.shipment_id
    ) ship_out ON TRUE
    LEFT JOIN staff shipped_out_staff ON shipped_out_staff.id = ship_out.shipped_out_by
    LEFT JOIN fba_fnskus ff ON ff.fnsku = sal.fnsku
    LEFT JOIN staff packed_staff ON packed_staff.id = sal.staff_id
    LEFT JOIN LATERAL (
        SELECT ord.id
        FROM orders ord
        LEFT JOIN shipment_links osl ON osl.owner_id = ord.id AND osl.owner_type = 'ORDER'
        LEFT JOIN shipping_tracking_numbers ord_stn ON ord_stn.id = ord.shipment_id
        WHERE (
            sal.shipment_id IS NOT NULL
            AND (
              osl.shipment_id = sal.shipment_id
              OR ord.shipment_id = sal.shipment_id
            )
        ) OR (
            COALESCE(stn.tracking_number_raw, sal.scan_ref, '') <> ''
            AND ord_stn.tracking_number_raw IS NOT NULL
            AND ord_stn.tracking_number_raw != ''
            AND RIGHT(regexp_replace(UPPER(ord_stn.tracking_number_raw), '[^A-Z0-9]', '', 'g'), 18) =
                RIGHT(regexp_replace(UPPER(COALESCE(stn.tracking_number_raw, sal.scan_ref, '')), '[^A-Z0-9]', '', 'g'), 18)
        )
        ORDER BY
            CASE
              WHEN sal.shipment_id IS NOT NULL AND osl.shipment_id = sal.shipment_id THEN 0
              WHEN sal.shipment_id IS NOT NULL AND ord.shipment_id = sal.shipment_id THEN 1
              ELSE 2
            END,
            CASE WHEN COALESCE(osl.is_primary, false) THEN 0 ELSE 1 END,
            ord.created_at DESC NULLS LAST,
            ord.id DESC
        LIMIT 1
    ) order_match ON TRUE
    LEFT JOIN orders o ON o.id = order_match.id AND o.organization_id = sal.organization_id
    LEFT JOIN orders_exceptions oe ON oe.id = sal.orders_exception_id
    LEFT JOIN LATERAL (
        SELECT COALESCE(
            NULLIF(BTRIM(sc_e.product_title), ''),
            NULLIF(BTRIM(sp_e.display_name), '')
        ) AS ecwid_product_title
        FROM sku_platform_ids sp_e
        LEFT JOIN sku_catalog sc_e ON sc_e.id = sp_e.sku_catalog_id
          AND sc_e.organization_id = sal.organization_id
        WHERE sp_e.platform = 'ecwid'
          AND sp_e.is_active = true
          AND sp_e.organization_id = sal.organization_id
          AND EXISTS (
            SELECT 1
            FROM UNNEST(ARRAY[
                NULLIF(BTRIM(split_part(COALESCE(sku_lookup.sku_table_static_sku, ''), ':', 1)), ''),
                NULLIF(BTRIM(COALESCE(sku_lookup.sku_table_static_sku, '')), ''),
                NULLIF(BTRIM(split_part(COALESCE(sal.metadata->>'sku', ''), ':', 1)), ''),
                NULLIF(BTRIM(COALESCE(sal.metadata->>'sku', '')), ''),
                CASE
                    WHEN POSITION(':' IN COALESCE(sal.scan_ref, '')) > 0
                    THEN NULLIF(BTRIM(split_part(sal.scan_ref, ':', 1)), '')
                    ELSE NULLIF(BTRIM(COALESCE(sal.scan_ref, '')), '')
                END,
                NULLIF(BTRIM(split_part(COALESCE(o.sku, ''), ':', 1)), ''),
                NULLIF(BTRIM(COALESCE(o.sku, '')), ''),
                NULLIF(BTRIM(COALESCE(o.item_number, '')), '')
            ]) AS c(candidate)
            WHERE c.candidate IS NOT NULL AND BTRIM(c.candidate) <> ''
              AND (
                  BTRIM(sp_e.platform_sku) = BTRIM(c.candidate)
                  OR BTRIM(sp_e.platform_item_id) = BTRIM(c.candidate)
                  OR regexp_replace(UPPER(TRIM(COALESCE(sp_e.platform_sku, ''))), '^0+', '') =
                     regexp_replace(UPPER(TRIM(c.candidate)), '^0+', '')
              )
          )
        ORDER BY
            CASE WHEN NULLIF(BTRIM(COALESCE(sc_e.product_title, '')), '') IS NOT NULL THEN 0 ELSE 1 END,
            sp_e.created_at DESC NULLS LAST,
            sp_e.id DESC
        LIMIT 1
    ) ecwid_lookup ON TRUE
    LEFT JOIN LATERAL (
        SELECT sc.product_title AS catalog_product_title
        FROM sku_catalog sc
        WHERE sc.organization_id = sal.organization_id
          AND EXISTS (
            SELECT 1
            FROM UNNEST(ARRAY[
                NULLIF(BTRIM(split_part(COALESCE(sku_lookup.sku_table_static_sku, ''), ':', 1)), ''),
                NULLIF(BTRIM(COALESCE(sku_lookup.sku_table_static_sku, '')), ''),
                NULLIF(BTRIM(split_part(COALESCE(sal.metadata->>'sku', ''), ':', 1)), ''),
                NULLIF(BTRIM(COALESCE(sal.metadata->>'sku', '')), ''),
                CASE
                    WHEN POSITION(':' IN COALESCE(sal.scan_ref, '')) > 0
                    THEN NULLIF(BTRIM(split_part(sal.scan_ref, ':', 1)), '')
                    ELSE NULLIF(BTRIM(COALESCE(sal.scan_ref, '')), '')
                END,
                CASE
                    WHEN POSITION(':' IN COALESCE(sal.scan_ref, '')) > 0
                    THEN NULLIF(BTRIM(split_part(sal.scan_ref, ':', 2)), '')
                    ELSE NULL
                END,
                NULLIF(BTRIM(split_part(COALESCE(o.sku, ''), ':', 1)), ''),
                NULLIF(BTRIM(COALESCE(o.sku, '')), ''),
                NULLIF(BTRIM(COALESCE(o.item_number, '')), ''),
                NULLIF(BTRIM(split_part(COALESCE(ff.sku, ''), ':', 1)), ''),
                NULLIF(BTRIM(COALESCE(ff.sku, '')), '')
            ]) AS c(candidate)
            WHERE c.candidate IS NOT NULL AND BTRIM(c.candidate) <> ''
              AND (
                  BTRIM(sc.sku) = BTRIM(c.candidate)
                  OR regexp_replace(UPPER(TRIM(COALESCE(sc.sku, ''))), '^0+', '') =
                     regexp_replace(UPPER(TRIM(c.candidate)), '^0+', '')
              )
        )
        LIMIT 1
    ) sku_catalog_lookup ON TRUE
    LEFT JOIN LATERAL (
        SELECT ss.product_title AS stock_product_title
        FROM sku_stock ss
        WHERE ss.organization_id = sal.organization_id
          AND EXISTS (
            SELECT 1
            FROM UNNEST(ARRAY[
                NULLIF(BTRIM(split_part(COALESCE(sku_lookup.sku_table_static_sku, ''), ':', 1)), ''),
                NULLIF(BTRIM(COALESCE(sku_lookup.sku_table_static_sku, '')), ''),
                NULLIF(BTRIM(split_part(COALESCE(sal.metadata->>'sku', ''), ':', 1)), ''),
                NULLIF(BTRIM(COALESCE(sal.metadata->>'sku', '')), ''),
                CASE
                    WHEN POSITION(':' IN COALESCE(sal.scan_ref, '')) > 0
                    THEN NULLIF(BTRIM(split_part(sal.scan_ref, ':', 1)), '')
                    ELSE NULLIF(BTRIM(COALESCE(sal.scan_ref, '')), '')
                END,
                CASE
                    WHEN POSITION(':' IN COALESCE(sal.scan_ref, '')) > 0
                    THEN NULLIF(BTRIM(split_part(sal.scan_ref, ':', 2)), '')
                    ELSE NULL
                END,
                NULLIF(BTRIM(split_part(COALESCE(o.sku, ''), ':', 1)), ''),
                NULLIF(BTRIM(COALESCE(o.sku, '')), ''),
                NULLIF(BTRIM(COALESCE(o.item_number, '')), ''),
                NULLIF(BTRIM(split_part(COALESCE(ff.sku, ''), ':', 1)), ''),
                NULLIF(BTRIM(COALESCE(ff.sku, '')), '')
            ]) AS c(candidate)
            WHERE c.candidate IS NOT NULL AND BTRIM(c.candidate) <> ''
              AND (
                  BTRIM(ss.sku) = BTRIM(c.candidate)
                  OR regexp_replace(UPPER(TRIM(COALESCE(ss.sku, ''))), '^0+', '') =
                     regexp_replace(UPPER(TRIM(c.candidate)), '^0+', '')
              )
        )
        ORDER BY
            CASE WHEN NULLIF(BTRIM(COALESCE(ss.product_title, '')), '') IS NULL THEN 1 ELSE 0 END,
            ss.stock DESC NULLS LAST,
            ss.id DESC
        LIMIT 1
    ) sku_stock_lookup ON TRUE
    LEFT JOIN LATERAL (
        SELECT COALESCE(
          json_agg(t.tracking_number_raw ORDER BY t.sort_key, t.tracking_number_raw)
            FILTER (WHERE COALESCE(t.tracking_number_raw, '') <> ''),
          '[]'::json
        ) AS tracking_numbers,
        COALESCE(
          json_agg(
            json_build_object(
              'shipment_id', t.shipment_id,
              'tracking', t.tracking_number_raw,
              'is_primary', t.is_primary
            )
            ORDER BY t.sort_key, t.tracking_number_raw
          ) FILTER (WHERE COALESCE(t.tracking_number_raw, '') <> ''),
          '[]'::json
        ) AS tracking_number_rows
        FROM (
          SELECT DISTINCT
            osl_link.shipment_id,
            stn_link.tracking_number_raw,
            COALESCE(osl_link.is_primary, false) AS is_primary,
            CASE WHEN COALESCE(osl_link.is_primary, false) THEN 0 ELSE 1 END AS sort_key
          FROM shipment_links osl_link
          LEFT JOIN shipping_tracking_numbers stn_link ON stn_link.id = osl_link.shipment_id
          WHERE osl_link.owner_type = 'ORDER' AND o.id IS NOT NULL
            AND osl_link.owner_id = o.id

          UNION

          SELECT DISTINCT
            o_primary.shipment_id,
            stn_primary.tracking_number_raw,
            true AS is_primary,
            0 AS sort_key
          FROM orders o_primary
          LEFT JOIN shipping_tracking_numbers stn_primary ON stn_primary.id = o_primary.shipment_id
          WHERE o.id IS NOT NULL
            AND o_primary.id = o.id
        ) t
    ) order_trackings ON TRUE
    LEFT JOIN LATERAL (
        SELECT wa.deadline_at
        FROM work_assignments wa
        WHERE wa.entity_type = 'ORDER'
          AND wa.entity_id = o.id
          AND wa.work_type = 'TEST'
        ORDER BY
          CASE wa.status
            WHEN 'IN_PROGRESS' THEN 1
            WHEN 'ASSIGNED' THEN 2
            WHEN 'OPEN' THEN 3
            WHEN 'DONE' THEN 4
            ELSE 5
          END,
          wa.updated_at DESC,
          wa.id DESC
        LIMIT 1
    ) wa_deadline ON TRUE
    LEFT JOIN LATERAL (
        SELECT wa.assigned_tech_id
        FROM work_assignments wa
        WHERE wa.entity_type = 'ORDER'
          AND wa.entity_id = o.id
          AND wa.work_type = 'TEST'
          AND wa.status IN ('ASSIGNED', 'IN_PROGRESS')
        ORDER BY wa.created_at DESC, wa.id DESC
        LIMIT 1
    ) wa_t ON TRUE
    LEFT JOIN LATERAL (
        SELECT
            COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.created_at), '') AS serial_number,
            MIN(tsn.tested_by)::int AS tested_by,
            MIN(tsn.created_at)::text AS test_date_time
        FROM tech_serial_numbers tsn
        WHERE o.shipment_id IS NOT NULL
          AND tsn.shipment_id = o.shipment_id
    ) test_data ON TRUE
    LEFT JOIN staff tested_staff ON tested_staff.id = test_data.tested_by
    LEFT JOIN staff tester_staff ON tester_staff.id = wa_t.assigned_tech_id
    ORDER BY sal.created_at DESC NULLS LAST
  `;

  // Read-model path (PACKER_LOG_ENRICHMENT_READ): the 6 non-indexable per-row
  // laterals (sku_lookup / order_match / ecwid / sku_catalog / sku_stock /
  // order_trackings) are replaced by a single 1:1 join to the precomputed
  // `packer_log_enrichment` projection. orders is re-joined cheaply on
  // enr.order_row_id so every live o.* column (status_history, notes, condition,
  // quantity) and the volatile stn carrier status / staff / deadline / scan-out
  // laterals stay exactly as fresh as before. Column shape is identical to the
  // legacy query (same aliases), so the route + client are unaffected. A
  // not-yet-backfilled row has enr = NULL and degrades to the order's own title.
  const enrichedQuery = `
    ${pageCte}
    SELECT
        sal.id,
        sal.packer_log_id AS packer_log_id,
        to_char(sal.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
        sal.scan_ref,
        COALESCE(stn.tracking_number_raw, oe.shipping_tracking_number, sal.scan_ref, sal.fnsku) AS shipping_tracking_number,
        oe.id AS orders_exception_id,
        oe.exception_reason,
        oe.status AS exception_status,
        CASE WHEN oe.id IS NOT NULL AND o.id IS NULL THEN 'exception' ELSE 'order' END AS row_source,
        sal.staff_id AS packed_by,
        packed_staff.name AS packed_by_name,
        COALESCE(pl.tracking_type,
                 CASE sal.activity_type
                   WHEN 'FBA_READY' THEN 'FNSKU'
                   WHEN 'PACK_COMPLETED' THEN 'ORDERS'
                   ELSE 'SCAN'
                 END) AS tracking_type,
        NULL::json AS packer_photos_url,
        o.id AS order_row_id,
        o.shipment_id,
        o.order_id,
        COALESCE(o.account_source, CASE WHEN sal.fnsku IS NOT NULL THEN 'fba' ELSE null END) AS account_source,
        COALESCE(enr.tracking_numbers, '[]'::jsonb) AS tracking_numbers,
        COALESCE(enr.tracking_number_rows, '[]'::jsonb) AS tracking_number_rows,
        COALESCE(
            ff.product_title,
            o.product_title,
            enr.external_product_title,
            NULLIF(BTRIM(o.item_number), ''),
            NULLIF(BTRIM(o.sku), '')
        ) AS product_title,
        to_char(wa_deadline.deadline_at, 'YYYY-MM-DD HH24:MI:SS') AS ship_by_date,
        to_char(wa_deadline.deadline_at, 'YYYY-MM-DD HH24:MI:SS') AS deadline_at,
        o.item_number,
        NULLIF(TRIM(COALESCE(o.condition, '')), '') AS condition,
        COALESCE(o.quantity, sal.metadata->>'quantity') AS quantity,
        COALESCE(
            o.sku,
            ff.sku,
            sal.metadata->>'sku',
            CASE WHEN POSITION(':' IN COALESCE(sal.scan_ref, '')) > 0
                 THEN TRIM(split_part(sal.scan_ref, ':', 1))
                 ELSE NULL
            END
        ) AS sku,
        COALESCE(o.notes, '') AS notes,
        COALESCE(o.status_history, '[]'::jsonb) AS status_history,
        COALESCE(
            NULLIF(TRIM(COALESCE(test_data.serial_number, '')), ''),
            NULLIF(TRIM(COALESCE(enr.sku_table_serial, '')), '')
        ) AS serial_number,
        enr.sku_table_id AS sku_table_id,
        wa_t.assigned_tech_id AS tester_id,
        test_data.tested_by,
        test_data.test_date_time,
        tested_staff.name AS tested_by_name,
        tester_staff.name AS tester_name,
        sal.fnsku,
        (NULLIF(TRIM(sal.metadata->>'fnsku_log_id'), ''))::bigint AS fnsku_log_id,
        stn.carrier                            AS carrier,
        stn.latest_status_code                 AS latest_status_code,
        stn.latest_status_label                AS latest_status_label,
        stn.latest_status_description          AS latest_status_description,
        stn.latest_status_category             AS latest_status_category,
        stn.latest_event_at::text              AS latest_event_at,
        stn.has_exception                      AS has_exception,
        stn.exception_at::text                 AS exception_at,
        stn.is_terminal                        AS is_terminal,
        to_char(ship_out.ship_confirmed_at, 'YYYY-MM-DD HH24:MI:SS') AS ship_confirmed_at,
        ship_out.shipped_out_by                AS shipped_out_by,
        shipped_out_staff.name                 AS shipped_out_by_name
    FROM station_activity_logs sal
    JOIN page ON page.id = sal.id
    LEFT JOIN packer_logs pl ON pl.id = sal.packer_log_id
    LEFT JOIN packer_log_enrichment enr ON enr.sal_id = sal.id
    LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
    LEFT JOIN LATERAL (
        SELECT
            MAX(so.created_at) AS ship_confirmed_at,
            (ARRAY_AGG(so.staff_id ORDER BY so.created_at DESC))[1] AS shipped_out_by
        FROM station_activity_logs so
        WHERE so.activity_type = 'SHIP_CONFIRM'
          AND sal.shipment_id IS NOT NULL
          AND so.shipment_id = sal.shipment_id
    ) ship_out ON TRUE
    LEFT JOIN staff shipped_out_staff ON shipped_out_staff.id = ship_out.shipped_out_by
    LEFT JOIN fba_fnskus ff ON ff.fnsku = sal.fnsku
    LEFT JOIN staff packed_staff ON packed_staff.id = sal.staff_id
    LEFT JOIN orders o ON o.id = enr.order_row_id AND o.organization_id = sal.organization_id
    LEFT JOIN orders_exceptions oe ON oe.id = sal.orders_exception_id
    LEFT JOIN LATERAL (
        SELECT wa.deadline_at
        FROM work_assignments wa
        WHERE wa.entity_type = 'ORDER'
          AND wa.entity_id = o.id
          AND wa.work_type = 'TEST'
        ORDER BY
          CASE wa.status
            WHEN 'IN_PROGRESS' THEN 1
            WHEN 'ASSIGNED' THEN 2
            WHEN 'OPEN' THEN 3
            WHEN 'DONE' THEN 4
            ELSE 5
          END,
          wa.updated_at DESC,
          wa.id DESC
        LIMIT 1
    ) wa_deadline ON TRUE
    LEFT JOIN LATERAL (
        SELECT wa.assigned_tech_id
        FROM work_assignments wa
        WHERE wa.entity_type = 'ORDER'
          AND wa.entity_id = o.id
          AND wa.work_type = 'TEST'
          AND wa.status IN ('ASSIGNED', 'IN_PROGRESS')
        ORDER BY wa.created_at DESC, wa.id DESC
        LIMIT 1
    ) wa_t ON TRUE
    LEFT JOIN LATERAL (
        SELECT
            COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.created_at), '') AS serial_number,
            MIN(tsn.tested_by)::int AS tested_by,
            MIN(tsn.created_at)::text AS test_date_time
        FROM tech_serial_numbers tsn
        WHERE o.shipment_id IS NOT NULL
          AND tsn.shipment_id = o.shipment_id
    ) test_data ON TRUE
    LEFT JOIN staff tested_staff ON tested_staff.id = test_data.tested_by
    LEFT JOIN staff tester_staff ON tester_staff.id = wa_t.assigned_tech_id
    ORDER BY sal.created_at DESC NULLS LAST
  `;

  const query = isPackerLogEnrichmentRead() ? enrichedQuery : legacyQuery;

  const result = await queryWithRetry(
    () => pool.query(query, params),
    { retries: 3, delayMs: 1000 },
  );

  const packerLogIds = result.rows
    .map((r: any) => r.packer_log_id)
    .filter((id: any) => id != null);

  const photosMap: Record<number, any[]> = {};
  if (packerLogIds.length > 0) {
    try {
      const photosResult = await pool.query(
        `SELECT l.entity_id,
                json_agg(
                  json_build_object(
                    'id', p.id,
                    'url', '/api/photos/' || p.id::text || '/content',
                    'uploadedAt', p.created_at
                  )
                  ORDER BY p.created_at
                ) AS photos
           FROM photos p
           JOIN photo_entity_links l
             ON l.photo_id = p.id
            AND l.organization_id = p.organization_id
          WHERE l.entity_type = 'PACKER_LOG'
            AND l.link_role = 'primary'
            AND l.entity_id = ANY($1)
            AND l.organization_id = $2
          GROUP BY l.entity_id`,
        [packerLogIds, orgId],
      );
      for (const row of photosResult.rows) {
        photosMap[row.entity_id] = row.photos;
      }
    } catch (error) {
      console.warn('[packer-logs-week] photo lookup failed; returning rows without photos', error);
    }
  }

  const rows = result.rows.map((r: any) => ({
    ...r,
    packer_photos_url: photosMap[r.packer_log_id] ?? [],
  }));

  // Defer the cache write so it never blocks TTFB. Safe in both Route Handlers
  // and Server Components on Next 16.
  after(() => setCachedJson(CACHE_NAMESPACE, cacheLookup, rows, cacheTTL, CACHE_TAGS));

  return { rows, cacheTTL, cacheHit: false };
}
