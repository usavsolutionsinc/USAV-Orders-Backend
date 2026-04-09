import pool from '../db';
import { formatPSTTimestamp } from '@/utils/date';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';
import { queryWithRetry } from '@/lib/db-retry';
import { getShippedSearchFieldConfig, type ShippedSearchField } from '@/lib/shipped-search';
import { buildRankedSearchSql, buildTextSearchVariants, type RankedSearchVariant } from '@/lib/search/sql-ranked-search';

// Order record with shipping information
export interface ShippedOrder {
  id: number;
  deadline_at?: string | null;
  ship_by_date?: string | null;
  order_id: string;
  product_title: string;
  quantity?: string | null;
  item_number?: string | null;
  condition: string;
  shipment_id?: number | string | null;
  shipping_tracking_number?: string | null;
  tracking_numbers?: string[] | null;
  tracking_number_rows?: Array<{
    shipment_id: number | null;
    tracking: string;
    is_primary: boolean;
  }> | null;
  serial_number: string; // Aggregated from tech_serial_numbers
  sku: string;
  /** Staff ID assigned to test — sourced from work_assignments.assigned_tech_id */
  tester_id: number | null;
  tested_by: number | null;
  test_date_time: string | null;   // aliased from tsn.created_at
  test_activity_at?: string | null;
  next_test_activity_at?: string | null;
  /** Staff ID assigned to pack — sourced from work_assignments.assigned_packer_id */
  packer_id: number | null;
  packed_by: number | null;
  packed_at: string | null;        // packer_logs.created_at (scan timestamp)
  pack_activity_at?: string | null;
  next_pack_activity_at?: string | null;
  pack_duration?: string | null;
  test_duration?: string | null;
  packer_photos_url: any;
  tracking_type: string | null;
  account_source: string | null;
  notes: string;
  status_history: any;
  /** Derived from shipping_tracking_numbers carrier status — not stored on orders */
  is_shipped?: boolean;
  shipment_status?: string | null;
  latest_status_code?: string | null;
  latest_status_label?: string | null;
  latest_status_description?: string | null;
  latest_status_category?: string | null;
  is_delivered?: boolean;
  carrier?: string | null;
  created_at: string | null;
  tested_by_name?: string | null;
  packed_by_name?: string | null;
  tester_name?: string | null;
  /** `packer_logs.id` for DELETE; from packerlogs API join. */
  packer_log_id?: number | null;
  /** `station_activity_logs.id` when delete has no packer_logs row (e.g. some FBA scans). */
  station_activity_log_id?: number | null;
  row_source?: 'order' | 'exception';
  exception_reason?: string | null;
  exception_status?: string | null;
  fnsku?: string | null;
  fnsku_log_id?: number | null;
  /** SAL row id — single source of truth anchor for this scan session. */
  sal_id?: number | null;
}

export interface ActiveOrder {
  id: number;
  shipment_id: number | null;
  order_id: string;
  product_title: string;
  quantity: string | null;
  item_number: string | null;
  condition: string;
  /** Sourced from shipping_tracking_numbers.tracking_number_raw via shipment_id join */
  tracking_number?: string | null;
  shipping_tracking_number?: string | null;
  sku: string | null;
  account_source: string | null;
  notes: string | null;
  status_history: any;
  /** Derived from shipping_tracking_numbers carrier status */
  is_shipped: boolean;
  shipment_status?: string | null;
  carrier?: string | null;
  deadline_at?: string | null;
  ship_by_date?: string | null;
  out_of_stock: string | null;
  created_at: string | null;
  tester_id: number | null;
  packer_id: number | null;
  tested_by: number | null;
  packed_by: number | null;
  packed_at: string | null;        // packer_logs.created_at (scan timestamp)
  serial_number: string | null;
}

export interface CreateOrderParams {
  orderId: string;
  productTitle: string;
  sku?: string | null;
  accountSource?: string | null;
  condition?: string;
  quantity?: string | null;
  itemNumber?: string | null;
  shipByDate?: string | null;
  notes?: string | null;
}

// ─── Shared CTE fragments ─────────────────────────────────────────────────────

/**
 * The order_serials CTE: joins orders with work_assignments, packer_logs, tech_serial_numbers.
 * Returns all columns needed for ShippedOrder.
 */
/**
 * Lateral join fragment that resolves the canonical deadline for an order from work_assignments.
 * Priority: IN_PROGRESS > ASSIGNED > OPEN > DONE. Alias: wa_deadline.deadline_at.
 */
const WA_DEADLINE_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT wa.deadline_at
    FROM work_assignments wa
    WHERE wa.entity_type = 'ORDER'
      AND wa.entity_id   = o.id
      AND wa.work_type   = 'TEST'
    ORDER BY
      CASE wa.status
        WHEN 'IN_PROGRESS' THEN 1
        WHEN 'ASSIGNED'    THEN 2
        WHEN 'OPEN'        THEN 3
        WHEN 'DONE'        THEN 4
        ELSE 5
      END,
      wa.updated_at DESC,
      wa.id DESC
    LIMIT 1
  ) wa_deadline ON TRUE`;

const ORDER_SERIALS_CTE = `
  order_serials AS (
    SELECT
      o.id,
      o.shipment_id,
      to_char(wa_deadline.deadline_at, 'YYYY-MM-DD HH24:MI:SS') AS ship_by_date,
      o.order_id,
      o.product_title,
      o.quantity,
      o.item_number,
      o.condition,
      stn.tracking_number_raw AS tracking_number,
      stn.tracking_number_raw AS shipping_tracking_number,
      COALESCE(order_trackings.tracking_numbers, '[]'::jsonb) AS tracking_numbers,
      COALESCE(order_trackings.tracking_number_rows, '[]'::jsonb) AS tracking_number_rows,
      o.sku,
      o.account_source,
      o.notes,
      COALESCE(o.status_history::jsonb, '[]'::jsonb) AS status_history,
      COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
        OR stn.is_out_for_delivery OR stn.is_delivered, false) AS is_shipped,
      stn.latest_status_category AS shipment_status,
      stn.is_delivered,
      stn.carrier,
      to_char(o.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
      'order'::text AS row_source,
      NULL::text AS exception_reason,
      NULL::text AS exception_status,
      wa_t.assigned_tech_id   AS tester_id,
      wa_p.assigned_packer_id AS packer_id,
      pl.packed_by,
      to_char(pl.packed_at, 'YYYY-MM-DD HH24:MI:SS') AS packed_at,
      to_char(pack_sal.created_at, 'YYYY-MM-DD HH24:MI:SS') AS pack_activity_at,
      pl.packer_photos_url,
      pl.tracking_type,
      COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.created_at), '') AS serial_number,
      MIN(tsn.tested_by)::int AS tested_by,
      MIN(tsn.created_at)::text AS test_date_time,
      to_char(test_sal.created_at, 'YYYY-MM-DD HH24:MI:SS') AS test_activity_at
    FROM orders o
    ${WA_DEADLINE_LATERAL}
    LEFT JOIN LATERAL (
      SELECT assigned_tech_id
      FROM work_assignments
      WHERE entity_type = 'ORDER' AND entity_id = o.id AND work_type = 'TEST'
        AND status IN ('ASSIGNED', 'IN_PROGRESS')
      ORDER BY created_at DESC LIMIT 1
    ) wa_t ON true
    LEFT JOIN LATERAL (
      SELECT assigned_packer_id
      FROM work_assignments
      WHERE entity_type = 'ORDER' AND entity_id = o.id AND work_type = 'PACK'
        AND status IN ('ASSIGNED', 'IN_PROGRESS')
      ORDER BY created_at DESC LIMIT 1
    ) wa_p ON true
    LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        jsonb_agg(t.tracking_number_raw ORDER BY t.sort_key, t.tracking_number_raw)
          FILTER (WHERE COALESCE(t.tracking_number_raw, '') <> ''),
        '[]'::jsonb
      ) AS tracking_numbers,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'shipment_id', t.shipment_id,
            'tracking', t.tracking_number_raw,
            'is_primary', t.is_primary
          )
          ORDER BY t.sort_key, t.tracking_number_raw
        ) FILTER (WHERE COALESCE(t.tracking_number_raw, '') <> ''),
        '[]'::jsonb
      ) AS tracking_number_rows
      FROM (
        SELECT DISTINCT
          osl_link.shipment_id,
          stn_link.tracking_number_raw,
          COALESCE(osl_link.is_primary, false) AS is_primary,
          CASE WHEN COALESCE(osl_link.is_primary, false) THEN 0 ELSE 1 END AS sort_key
        FROM order_shipment_links osl_link
        LEFT JOIN shipping_tracking_numbers stn_link ON stn_link.id = osl_link.shipment_id
        WHERE osl_link.order_row_id = o.id

        UNION

        SELECT DISTINCT
          o_primary.shipment_id,
          stn_primary.tracking_number_raw,
          true AS is_primary,
          0 AS sort_key
        FROM orders o_primary
        LEFT JOIN shipping_tracking_numbers stn_primary ON stn_primary.id = o_primary.shipment_id
        WHERE o_primary.id = o.id

        UNION

        SELECT DISTINCT
          o_sibling.shipment_id,
          stn_sibling.tracking_number_raw,
          false AS is_primary,
          2 AS sort_key
        FROM orders o_sibling
        LEFT JOIN shipping_tracking_numbers stn_sibling ON stn_sibling.id = o_sibling.shipment_id
        WHERE o_sibling.order_id = o.order_id
      ) t
    ) order_trackings ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        pl.packed_by,
        pl.created_at AS packed_at,
        pl.tracking_type,
        COALESCE((
          SELECT jsonb_agg(p.url ORDER BY p.created_at ASC)
          FROM photos p
          WHERE p.entity_type = 'PACKER_LOG'
            AND p.entity_id = pl.id
        ), '[]'::jsonb) AS packer_photos_url
      FROM packer_logs pl
      WHERE pl.shipment_id IS NOT NULL
        AND pl.shipment_id = o.shipment_id
        AND pl.tracking_type = 'ORDERS'
      ORDER BY pl.created_at DESC NULLS LAST, pl.id DESC
      LIMIT 1
    ) pl ON true
    LEFT JOIN LATERAL (
      SELECT sal.created_at
      FROM station_activity_logs sal
      WHERE sal.station = 'PACK'
        AND sal.shipment_id IS NOT NULL
        AND sal.shipment_id = o.shipment_id
        AND sal.activity_type IN ('PACK_COMPLETED', 'PACK_SCAN')
      ORDER BY sal.created_at DESC NULLS LAST, sal.id DESC
      LIMIT 1
    ) pack_sal ON true
    LEFT JOIN LATERAL (
      SELECT sal.created_at
      FROM station_activity_logs sal
      WHERE sal.station = 'TECH'
        AND sal.shipment_id IS NOT NULL
        AND sal.shipment_id = o.shipment_id
        AND sal.activity_type = 'SERIAL_ADDED'
      ORDER BY sal.created_at DESC NULLS LAST, sal.id DESC
      LIMIT 1
    ) test_sal ON true
    LEFT JOIN tech_serial_numbers tsn ON tsn.shipment_id = o.shipment_id AND o.shipment_id IS NOT NULL
    WHERE COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
            OR stn.is_out_for_delivery OR stn.is_delivered, false)
    GROUP BY o.id, o.shipment_id, wa_deadline.deadline_at, o.order_id, o.product_title, o.quantity,
             o.condition, o.item_number, stn.tracking_number_raw, order_trackings.tracking_numbers, order_trackings.tracking_number_rows, o.sku,
             o.account_source, o.notes, o.status_history::jsonb,
             stn.is_carrier_accepted, stn.is_in_transit, stn.is_out_for_delivery, stn.is_delivered,
             stn.latest_status_category, stn.carrier,
             wa_t.assigned_tech_id, wa_p.assigned_packer_id,
             pl.packed_by, pl.packed_at, pl.packer_photos_url, pl.tracking_type,
             pack_sal.created_at, test_sal.created_at
  )`;

// ─── Shipped Orders (Read) ────────────────────────────────────────────────────

/**
 * Get all shipped orders with optional limit and offset
 */
export type ShippedFilterMode = 'all' | 'orders' | 'sku' | 'fba';

export interface GetAllShippedOrdersOptions {
  limit?: number;
  offset?: number;
  weekStart?: string;
  weekEnd?: string;
  packedBy?: number | null;
  testedBy?: number | null;
  missingTrackingOnly?: boolean;
  /** Filter records by order type. 'all' returns everything; default is no restriction. */
  shippedFilter?: ShippedFilterMode;
}

export async function getAllShippedOrders(limit: number, offset?: number): Promise<ShippedOrder[]>;
export async function getAllShippedOrders(options: GetAllShippedOrdersOptions): Promise<ShippedOrder[]>;
export async function getAllShippedOrders(
  limitOrOptions: number | GetAllShippedOrdersOptions = 100,
  offsetArg = 0,
): Promise<ShippedOrder[]> {
  try {
    const options: GetAllShippedOrdersOptions =
      typeof limitOrOptions === 'number'
        ? { limit: limitOrOptions, offset: offsetArg }
        : limitOrOptions;
    const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 100;
    const offset = Number.isFinite(Number(options.offset)) ? Number(options.offset) : 0;

    const conditions: string[] = [];
    const params: any[] = [];

    if (options.weekStart) {
      params.push(options.weekStart);
      conditions.push(`COALESCE(os.packed_at, os.created_at)::date >= $${params.length}::date`);
    }
    if (options.weekEnd) {
      params.push(options.weekEnd);
      conditions.push(`COALESCE(os.packed_at, os.created_at)::date <= $${params.length}::date`);
    }
    if (options.packedBy != null && Number.isFinite(Number(options.packedBy))) {
      params.push(Number(options.packedBy));
      conditions.push(`os.packed_by = $${params.length}`);
    }
    if (options.testedBy != null && Number.isFinite(Number(options.testedBy))) {
      params.push(Number(options.testedBy));
      conditions.push(`os.tested_by = $${params.length}`);
    }
    if (options.missingTrackingOnly) {
      conditions.push(`COALESCE(BTRIM(os.tracking_number), '') = ''`);
    }
    if (options.shippedFilter === 'orders') {
      conditions.push(`(LOWER(COALESCE(os.account_source, '')) != 'fba' AND os.order_id NOT ILIKE 'FBA%')`);
    } else if (options.shippedFilter === 'fba') {
      conditions.push(`(LOWER(COALESCE(os.account_source, '')) = 'fba' OR os.order_id ILIKE 'FBA%')`);
    } else if (options.shippedFilter === 'sku') {
      conditions.push(`BTRIM(COALESCE(os.sku, '')) != ''`);
    }
    // 'all' → no additional restriction

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(Math.max(1, limit), Math.max(0, offset));
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const sql = `WITH ${ORDER_SERIALS_CTE}
       SELECT
         os.*,
         s1.name AS tested_by_name,
         s2.name AS packed_by_name,
         s3.name AS tester_name
       FROM order_serials os
       LEFT JOIN staff s1 ON os.tested_by = s1.id
       LEFT JOIN staff s2 ON os.packed_by = s2.id
       LEFT JOIN staff s3 ON os.tester_id = s3.id
       ${whereClause}
       ORDER BY COALESCE(os.packed_at, os.created_at)::timestamp DESC NULLS LAST, os.id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

    const result = await queryWithRetry(
      () => pool.query(sql, params),
      { retries: 3, delayMs: 1000 },
    );
    return result.rows;
  } catch (error: any) {
    console.error('Error fetching shipped orders:', error.message);
    throw error;
  }
}

/**
 * AI-focused query: get orders packed within a date range.
 *
 * Unlike `getAllShippedOrders` (which requires carrier tracking confirmation),
 * this counts orders by their **pack date** — what the warehouse team actually
 * did that week. Includes orders packed but not yet carrier-confirmed.
 *
 * Falls back to carrier-shipped orders filtered by tracking update date if
 * pack data is sparse (covers the case where tracking confirms days later).
 */
export async function getPackedOrdersForAi(opts: {
  weekStart: string;
  weekEnd: string;
  limit?: number;
}): Promise<ShippedOrder[]> {
  const limit = opts.limit ?? 5000;
  try {
    const sql = `
      SELECT
        o.id,
        o.shipment_id,
        o.order_id,
        o.product_title,
        o.quantity,
        o.sku,
        o.account_source,
        to_char(o.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
        'order'::text AS row_source,
        pl.packed_by,
        s_packer.name AS packed_by_name,
        to_char(pl.packed_at, 'YYYY-MM-DD HH24:MI:SS') AS packed_at,
        wa_t.assigned_tech_id AS tester_id,
        s_tester.name AS tester_name,
        MIN(tsn.tested_by)::int AS tested_by,
        s_tested.name AS tested_by_name,
        stn.tracking_number_raw AS tracking_number,
        COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
          OR stn.is_out_for_delivery OR stn.is_delivered, false) AS is_shipped,
        stn.latest_status_category AS shipment_status
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT pl2.packed_by, pl2.created_at AS packed_at
        FROM packer_logs pl2
        WHERE pl2.shipment_id IS NOT NULL
          AND pl2.shipment_id = o.shipment_id
          AND pl2.tracking_type = 'ORDERS'
        ORDER BY pl2.created_at DESC NULLS LAST LIMIT 1
      ) pl ON true
      LEFT JOIN LATERAL (
        SELECT assigned_tech_id
        FROM work_assignments
        WHERE entity_type = 'ORDER' AND entity_id = o.id AND work_type = 'TEST'
          AND status IN ('ASSIGNED','IN_PROGRESS')
        ORDER BY created_at DESC LIMIT 1
      ) wa_t ON true
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
      LEFT JOIN tech_serial_numbers tsn ON tsn.shipment_id = o.shipment_id AND o.shipment_id IS NOT NULL
      LEFT JOIN staff s_packer ON s_packer.id = pl.packed_by
      LEFT JOIN staff s_tester ON s_tester.id = wa_t.assigned_tech_id
      LEFT JOIN staff s_tested ON s_tested.id = tsn.tested_by
      WHERE (
        -- Packed in this date range
        (pl.packed_at IS NOT NULL AND pl.packed_at::date >= $1::date AND pl.packed_at::date <= $2::date)
        OR
        -- OR carrier tracking confirmed in this date range
        (COALESCE(stn.is_carrier_accepted OR stn.is_in_transit OR stn.is_out_for_delivery OR stn.is_delivered, false)
         AND stn.updated_at::date >= $1::date AND stn.updated_at::date <= $2::date)
      )
      GROUP BY o.id, o.shipment_id, o.order_id, o.product_title, o.quantity, o.sku,
               o.account_source, o.created_at,
               pl.packed_by, pl.packed_at, s_packer.name,
               wa_t.assigned_tech_id, s_tester.name, s_tested.name,
               stn.tracking_number_raw, stn.is_carrier_accepted, stn.is_in_transit,
               stn.is_out_for_delivery, stn.is_delivered, stn.latest_status_category, stn.updated_at
      ORDER BY COALESCE(pl.packed_at, o.created_at) DESC NULLS LAST, o.id DESC
      LIMIT $3
    `;

    const result = await queryWithRetry(
      () => pool.query(sql, [opts.weekStart, opts.weekEnd, limit]),
      { retries: 3, delayMs: 1000 },
    );
    return result.rows;
  } catch (error: any) {
    console.error('Error fetching packed orders for AI:', error.message);
    throw error;
  }
}

/**
 * Get a single shipped order by ID (orders table only, no exceptions)
 */
export async function getShippedOrderById(id: number): Promise<ShippedOrder | null> {
  try {
    const result = await pool.query(
      `WITH order_serials AS (
        SELECT
          o.id,
          o.shipment_id,
          to_char(wa_deadline.deadline_at, 'YYYY-MM-DD HH24:MI:SS') AS ship_by_date,
          o.order_id,
          o.product_title,
          o.quantity,
          o.item_number,
          o.condition,
          stn.tracking_number_raw AS tracking_number,
          stn.tracking_number_raw AS shipping_tracking_number,
          COALESCE(order_trackings.tracking_numbers, '[]'::jsonb) AS tracking_numbers,
          COALESCE(order_trackings.tracking_number_rows, '[]'::jsonb) AS tracking_number_rows,
          o.sku,
          o.account_source,
          o.notes,
          COALESCE(o.status_history::jsonb, '[]'::jsonb) AS status_history,
          COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
            OR stn.is_out_for_delivery OR stn.is_delivered, false) AS is_shipped,
          stn.latest_status_category AS shipment_status,
          stn.is_delivered,
          stn.carrier,
          to_char(o.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
          wa_t.assigned_tech_id   AS tester_id,
          wa_p.assigned_packer_id AS packer_id,
          pl.packed_by,
          to_char(pl.packed_at, 'YYYY-MM-DD HH24:MI:SS') AS packed_at,
          to_char(pack_sal.created_at, 'YYYY-MM-DD HH24:MI:SS') AS pack_activity_at,
          pl.packer_photos_url,
          pl.tracking_type,
          COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.created_at), '') AS serial_number,
          MIN(tsn.tested_by)::int AS tested_by,
          MIN(tsn.created_at)::text AS test_date_time,
          to_char(test_sal.created_at, 'YYYY-MM-DD HH24:MI:SS') AS test_activity_at
        FROM orders o
        LEFT JOIN LATERAL (
          SELECT wa.deadline_at FROM work_assignments wa
          WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id AND wa.work_type = 'TEST'
          ORDER BY CASE wa.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2 WHEN 'OPEN' THEN 3 WHEN 'DONE' THEN 4 ELSE 5 END,
                   wa.updated_at DESC, wa.id DESC LIMIT 1
        ) wa_deadline ON TRUE
        LEFT JOIN LATERAL (
          SELECT assigned_tech_id FROM work_assignments
          WHERE entity_type = 'ORDER' AND entity_id = o.id AND work_type = 'TEST'
            AND status IN ('ASSIGNED', 'IN_PROGRESS')
          ORDER BY created_at DESC LIMIT 1
        ) wa_t ON true
        LEFT JOIN LATERAL (
          SELECT assigned_packer_id FROM work_assignments
          WHERE entity_type = 'ORDER' AND entity_id = o.id AND work_type = 'PACK'
            AND status IN ('ASSIGNED', 'IN_PROGRESS')
          ORDER BY created_at DESC LIMIT 1
        ) wa_p ON true
        LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            jsonb_agg(t.tracking_number_raw ORDER BY t.sort_key, t.tracking_number_raw)
              FILTER (WHERE COALESCE(t.tracking_number_raw, '') <> ''),
            '[]'::jsonb
          ) AS tracking_numbers,
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'shipment_id', t.shipment_id,
                'tracking', t.tracking_number_raw,
                'is_primary', t.is_primary
              )
              ORDER BY t.sort_key, t.tracking_number_raw
            ) FILTER (WHERE COALESCE(t.tracking_number_raw, '') <> ''),
            '[]'::jsonb
          ) AS tracking_number_rows
          FROM (
            SELECT DISTINCT
              osl_link.shipment_id,
              stn_link.tracking_number_raw,
              COALESCE(osl_link.is_primary, false) AS is_primary,
              CASE WHEN COALESCE(osl_link.is_primary, false) THEN 0 ELSE 1 END AS sort_key
            FROM order_shipment_links osl_link
            LEFT JOIN shipping_tracking_numbers stn_link ON stn_link.id = osl_link.shipment_id
            WHERE osl_link.order_row_id = o.id

            UNION

            SELECT DISTINCT
              o_primary.shipment_id,
              stn_primary.tracking_number_raw,
              true AS is_primary,
              0 AS sort_key
            FROM orders o_primary
            LEFT JOIN shipping_tracking_numbers stn_primary ON stn_primary.id = o_primary.shipment_id
            WHERE o_primary.id = o.id

            UNION

            SELECT DISTINCT
              o_sibling.shipment_id,
              stn_sibling.tracking_number_raw,
              false AS is_primary,
              2 AS sort_key
            FROM orders o_sibling
            LEFT JOIN shipping_tracking_numbers stn_sibling ON stn_sibling.id = o_sibling.shipment_id
            WHERE o_sibling.order_id = o.order_id
          ) t
        ) order_trackings ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            pl.packed_by,
            pl.created_at AS packed_at,
            pl.tracking_type,
            COALESCE((
              SELECT jsonb_agg(p.url ORDER BY p.created_at ASC)
              FROM photos p
              WHERE p.entity_type = 'PACKER_LOG'
                AND p.entity_id = pl.id
            ), '[]'::jsonb) AS packer_photos_url
          FROM packer_logs pl
          WHERE pl.shipment_id IS NOT NULL
            AND pl.shipment_id = o.shipment_id
            AND pl.tracking_type = 'ORDERS'
          ORDER BY pl.created_at DESC NULLS LAST, id DESC LIMIT 1
        ) pl ON true
        LEFT JOIN LATERAL (
          SELECT sal.created_at
          FROM station_activity_logs sal
          WHERE sal.station = 'PACK'
            AND sal.shipment_id IS NOT NULL
            AND sal.shipment_id = o.shipment_id
            AND sal.activity_type IN ('PACK_COMPLETED', 'PACK_SCAN')
          ORDER BY sal.created_at DESC NULLS LAST, sal.id DESC LIMIT 1
        ) pack_sal ON true
        LEFT JOIN LATERAL (
          SELECT sal.created_at
          FROM station_activity_logs sal
          WHERE sal.station = 'TECH'
            AND sal.shipment_id IS NOT NULL
            AND sal.shipment_id = o.shipment_id
            AND sal.activity_type = 'SERIAL_ADDED'
          ORDER BY sal.created_at DESC NULLS LAST, sal.id DESC LIMIT 1
        ) test_sal ON true
        LEFT JOIN tech_serial_numbers tsn ON tsn.shipment_id = o.shipment_id AND o.shipment_id IS NOT NULL
        WHERE o.id = $1
          AND COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
                OR stn.is_out_for_delivery OR stn.is_delivered, false)
        GROUP BY o.id, o.shipment_id, wa_deadline.deadline_at, o.order_id, o.product_title, o.quantity,
                 o.condition, o.item_number, stn.tracking_number_raw, order_trackings.tracking_numbers, order_trackings.tracking_number_rows, o.sku,
                 o.account_source, o.notes, o.status_history::jsonb,
                 stn.is_carrier_accepted, stn.is_in_transit, stn.is_out_for_delivery, stn.is_delivered,
                 stn.latest_status_category, stn.carrier,
                 wa_t.assigned_tech_id, wa_p.assigned_packer_id,
                 pl.packed_by, pl.packed_at, pl.packer_photos_url, pl.tracking_type,
                 pack_sal.created_at, test_sal.created_at
      )
      SELECT os.*,
             s1.name AS tested_by_name,
             s2.name AS packed_by_name,
             s3.name AS tester_name
      FROM order_serials os
      LEFT JOIN staff s1 ON os.tested_by = s1.id
      LEFT JOIN staff s2 ON os.packed_by = s2.id
      LEFT JOIN staff s3 ON os.tester_id = s3.id`,
      [id],
    );
    return result.rows[0] ?? null;
  } catch (error) {
    console.error('Error fetching shipped order by ID:', error);
    throw new Error('Failed to fetch shipped order');
  }
}

/**
 * Search shipped orders by tracking number, order ID, product title, or serial number.
 * Uses ORDER_SERIALS_CTE (carrier-shipped only). For packed-but-not-yet-carrier-shipped
 * orders, use searchPackedOrders as fallback.
 */
export async function searchShippedOrders(
  query: string,
  options?: { shippedFilter?: ShippedFilterMode; searchField?: ShippedSearchField },
): Promise<ShippedOrder[]> {
  try {
    const trimmedQuery = String(query || '').trim();
    const digitsOnly = trimmedQuery.replace(/\D/g, '');
    const last8 = digitsOnly.length >= 8 ? digitsOnly.slice(-8) : '';
    const key18 = normalizeTrackingKey18(trimmedQuery);
    const searchField = options?.searchField ?? 'all';

    // Build an optional AND clause for the type filter
    let typeFilterClause = '';
    if (options?.shippedFilter === 'orders') {
      typeFilterClause = ` AND (LOWER(COALESCE(os.account_source, '')) != 'fba' AND os.order_id NOT ILIKE 'FBA%')`;
    } else if (options?.shippedFilter === 'fba') {
      typeFilterClause = ` AND (LOWER(COALESCE(os.account_source, '')) = 'fba' OR os.order_id ILIKE 'FBA%')`;
    } else if (options?.shippedFilter === 'sku') {
      typeFilterClause = ` AND BTRIM(COALESCE(os.sku, '')) != ''`;
    }

    const searchConfig = getShippedSearchFieldConfig(searchField);

    const runSearch = async (enableFuzzy: boolean) => {
      const params: any[] = [];
      const pushParam = (value: any) => {
        params.push(value);
        return `$${params.length}`;
      };

      const wantsOrderId = searchField === 'all' || searchField === 'order_id';
      const wantsTracking = searchField === 'all' || searchField === 'tracking';
      const wantsProductTitle = searchField === 'all' || searchField === 'product_title';
      const wantsSku = searchField === 'all' || searchField === 'sku';
      const wantsSerial = searchField === 'all' || searchField === 'serial_number';
      const hasContainsSearch = searchField !== 'order_id';
      const hasPrefixSearch =
        searchField === 'all'
        || searchField === 'order_id'
        || searchField === 'product_title'
        || searchField === 'sku'
        || searchField === 'serial_number';
      const allowFuzzy = enableFuzzy && searchConfig.fuzzyEnabled && trimmedQuery.length >= searchConfig.fuzzyMinQueryLength;

      const exactParam = pushParam(trimmedQuery);
      const prefixParam = hasPrefixSearch ? pushParam(`${trimmedQuery}%`) : null;
      const likeParam = hasContainsSearch ? pushParam(`%${trimmedQuery}%`) : null;
      const fuzzyParam = allowFuzzy ? pushParam(trimmedQuery) : null;
      const last8Param = last8 && wantsTracking ? pushParam(last8) : null;
      const key18Param = key18 && wantsTracking ? pushParam(key18) : null;
      const numericParam =
        wantsOrderId && /^\d+$/.test(trimmedQuery) && trimmedQuery.length <= 10
          ? pushParam(Number(trimmedQuery))
          : null;

      const orderIdExpression = `COALESCE(os.order_id::text, '')`;
      const trackingExpression = `COALESCE(os.tracking_number::text, '')`;
      const productTitleExpression = `COALESCE(os.product_title::text, '')`;
      const skuExpression = `COALESCE(os.sku::text, '')`;
      const serialExpression = `COALESCE(os.serial_number::text, '')`;

      const variants: RankedSearchVariant[] = [];

      if (wantsOrderId) {
        variants.push(...buildTextSearchVariants({
          expression: orderIdExpression,
          exactParam,
          prefixParam,
          likeParam: searchField === 'all' ? likeParam : null,
          enableExact: true,
          enablePrefix: true,
          enableContains: searchField === 'all',
          enableFuzzy: false,
          exactScore: searchField === 'order_id' ? 1500 : 1450,
          prefixScore: searchField === 'order_id' ? 1320 : 1240,
          containsScore: 980,
        }));
      }

      if (wantsTracking) {
        variants.push(...buildTextSearchVariants({
          expression: trackingExpression,
          exactParam,
          likeParam,
          enableExact: true,
          enablePrefix: false,
          enableContains: true,
          enableFuzzy: false,
          exactScore: searchField === 'tracking' ? 1480 : 1380,
          containsScore: searchField === 'tracking' ? 1080 : 940,
        }));
      }

      if (wantsProductTitle) {
        variants.push(...buildTextSearchVariants({
          expression: productTitleExpression,
          exactParam,
          prefixParam,
          likeParam,
          fuzzyParam,
          enableExact: true,
          enablePrefix: true,
          enableContains: true,
          enableFuzzy: allowFuzzy,
          exactScore: searchField === 'product_title' ? 1280 : 860,
          prefixScore: searchField === 'product_title' ? 1120 : 740,
          containsScore: searchField === 'product_title' ? 920 : 660,
          fuzzyBaseScore: searchField === 'product_title' ? 700 : 520,
          fuzzyScale: 140,
          fuzzyThreshold: 0.22,
        }));
      }

      if (wantsSku) {
        variants.push(...buildTextSearchVariants({
          expression: skuExpression,
          exactParam,
          prefixParam,
          likeParam,
          fuzzyParam,
          enableExact: true,
          enablePrefix: true,
          enableContains: true,
          enableFuzzy: allowFuzzy,
          exactScore: searchField === 'sku' ? 1360 : 980,
          prefixScore: searchField === 'sku' ? 1180 : 860,
          containsScore: searchField === 'sku' ? 960 : 740,
          fuzzyBaseScore: searchField === 'sku' ? 760 : 560,
          fuzzyScale: 150,
          fuzzyThreshold: 0.32,
        }));
      }

      if (wantsSerial) {
        variants.push(...buildTextSearchVariants({
          expression: serialExpression,
          exactParam,
          prefixParam,
          likeParam,
          fuzzyParam,
          enableExact: true,
          enablePrefix: true,
          enableContains: true,
          enableFuzzy: allowFuzzy,
          exactScore: searchField === 'serial_number' ? 1380 : 1000,
          prefixScore: searchField === 'serial_number' ? 1200 : 880,
          containsScore: searchField === 'serial_number' ? 980 : 760,
          fuzzyBaseScore: searchField === 'serial_number' ? 780 : 580,
          fuzzyScale: 150,
          fuzzyThreshold: 0.36,
        }));
      }

      if (numericParam) {
        variants.push({
          predicate: `os.id = ${numericParam}`,
          score: 1420,
        });
      }

      if (last8Param && searchField === 'all') {
        variants.push({
          predicate: `RIGHT(regexp_replace(${orderIdExpression}, '[^0-9]', '', 'g'), 8) = ${last8Param}`,
          score: 1160,
        });
      }

      if (last8Param && wantsTracking) {
        variants.push({
          predicate: `RIGHT(regexp_replace(${trackingExpression}, '[^0-9]', '', 'g'), 8) = ${last8Param}`,
          score: searchField === 'tracking' ? 1320 : 1200,
        });
      }

      if (key18Param && wantsTracking) {
        variants.push({
          predicate: `os.shipment_id IN (
            SELECT s.id FROM shipping_tracking_numbers s
            WHERE RIGHT(regexp_replace(UPPER(COALESCE(s.tracking_number_normalized, '')), '[^A-Z0-9]', '', 'g'), 18) = ${key18Param}
          )`,
          score: searchField === 'tracking' ? 1400 : 1280,
        });
      }

      const { whereClause, rankClause } = buildRankedSearchSql(variants);

      return pool.query(
        `WITH ${ORDER_SERIALS_CTE}
         SELECT
           os.*,
           s1.name AS tested_by_name,
           s2.name AS packed_by_name,
           s3.name AS tester_name,
           ${rankClause} AS search_rank
         FROM order_serials os
         LEFT JOIN staff s1 ON os.tested_by = s1.id
         LEFT JOIN staff s2 ON os.packed_by = s2.id
         LEFT JOIN staff s3 ON os.tester_id = s3.id
         WHERE (
           ${whereClause}
         )${typeFilterClause}
         ORDER BY
           search_rank DESC,
           COALESCE(os.packed_at, os.created_at)::timestamp DESC NULLS LAST,
           os.id DESC
         LIMIT 100`,
        params,
      );
    };

    const searchExceptionTrackingRows = async (): Promise<ShippedOrder[]> => {
      const wantsTracking = searchField === 'all' || searchField === 'tracking';
      if (!wantsTracking) return [];

      const params: any[] = [];
      const pushParam = (value: any) => {
        params.push(value);
        return `$${params.length}`;
      };

      const exactParam = pushParam(trimmedQuery);
      const likeParam = pushParam(`%${trimmedQuery}%`);
      const last8Param = last8 ? pushParam(last8) : null;
      const key18Param = key18 ? pushParam(key18) : null;
      const trackingExpression = `COALESCE(oe.shipping_tracking_number, '')`;

      const variants: RankedSearchVariant[] = buildTextSearchVariants({
        expression: trackingExpression,
        exactParam,
        likeParam,
        enableExact: true,
        enablePrefix: false,
        enableContains: true,
        enableFuzzy: false,
        exactScore: searchField === 'tracking' ? 1460 : 1360,
        containsScore: searchField === 'tracking' ? 1060 : 920,
      });

      if (last8Param) {
        variants.push({
          predicate: `RIGHT(regexp_replace(${trackingExpression}, '[^0-9]', '', 'g'), 8) = ${last8Param}`,
          score: searchField === 'tracking' ? 1300 : 1180,
        });
      }

      if (key18Param) {
        variants.push({
          predicate: `RIGHT(regexp_replace(UPPER(${trackingExpression}), '[^A-Z0-9]', '', 'g'), 18) = ${key18Param}`,
          score: searchField === 'tracking' ? 1380 : 1260,
        });
      }

      const { whereClause, rankClause } = buildRankedSearchSql(variants);

      const result = await pool.query(
        `SELECT
           oe.id,
           NULL::bigint AS shipment_id,
           NULL::text AS ship_by_date,
           CONCAT('EX-', oe.id::text) AS order_id,
           CONCAT('Tracking Exception • ', INITCAP(COALESCE(oe.source_station, 'unknown'))) AS product_title,
           '1'::text AS quantity,
           NULL::text AS item_number,
           'EXCEPTION'::text AS condition,
           oe.shipping_tracking_number AS tracking_number,
           oe.shipping_tracking_number AS shipping_tracking_number,
           jsonb_build_array(oe.shipping_tracking_number) AS tracking_numbers,
           jsonb_build_array(
             jsonb_build_object(
               'shipment_id', NULL,
               'tracking', oe.shipping_tracking_number,
               'is_primary', true
             )
           ) AS tracking_number_rows,
           ''::text AS sku,
           NULL::text AS account_source,
           COALESCE(oe.notes, '') AS notes,
           '[]'::jsonb AS status_history,
           false AS is_shipped,
           oe.status AS shipment_status,
           false AS is_delivered,
           NULL::text AS carrier,
           to_char(oe.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
           'exception'::text AS row_source,
           oe.exception_reason,
           oe.status AS exception_status,
           NULL::int AS tester_id,
           NULL::int AS packer_id,
           oe.staff_id AS packed_by,
           to_char(oe.created_at, 'YYYY-MM-DD HH24:MI:SS') AS packed_at,
           NULL::text AS pack_activity_at,
           '[]'::jsonb AS packer_photos_url,
           'EXCEPTION'::text AS tracking_type,
           ''::text AS serial_number,
           NULL::int AS tested_by,
           NULL::text AS test_date_time,
           NULL::text AS test_activity_at,
           NULL::text AS tested_by_name,
           oe.staff_name AS packed_by_name,
           NULL::text AS tester_name,
           ${rankClause} AS search_rank
         FROM orders_exceptions oe
         WHERE oe.status = 'open'
           AND (${whereClause})
         ORDER BY search_rank DESC, oe.updated_at DESC, oe.id DESC
         LIMIT 25`,
        params,
      );

      return result.rows;
    };

    const mergeSearchRows = (rows: ShippedOrder[], exceptionRows: ShippedOrder[]) =>
      [...rows, ...exceptionRows]
        .sort((a, b) => {
          const rankA = Number((a as any).search_rank || 0);
          const rankB = Number((b as any).search_rank || 0);
          if (rankA !== rankB) return rankB - rankA;
          const dateA = new Date(String(a.packed_at || a.created_at || 0)).getTime();
          const dateB = new Date(String(b.packed_at || b.created_at || 0)).getTime();
          if (dateA !== dateB) return dateB - dateA;
          return Number(b.id) - Number(a.id);
        })
        .slice(0, 100);

    try {
      const result = await runSearch(true);
      const exceptionRows = await searchExceptionTrackingRows();
      return mergeSearchRows(result.rows, exceptionRows);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      const pgTrgmUnavailable =
        searchConfig.fuzzyEnabled
        && (message.includes('similarity') || message.includes('word_similarity'))
        && message.includes('does not exist');

      if (pgTrgmUnavailable) {
        console.warn('pg_trgm is unavailable for shipped search; falling back to exact/prefix/contains search.');
        const fallbackResult = await runSearch(false);
        const exceptionRows = await searchExceptionTrackingRows();
        return mergeSearchRows(fallbackResult.rows, exceptionRows);
      }

      throw error;
    }
  } catch (error) {
    console.error('Error searching shipped orders:', error);
    const message = error instanceof Error ? error.message : 'Failed to search shipped orders';
    throw new Error(message);
  }
}

/**
 * Get shipped orders by tracking number (last-8 digits match)
 */
export async function getShippedOrderByTracking(tracking: string): Promise<ShippedOrder | null> {
  try {
    const last8 = tracking.slice(-8).toLowerCase();
    const result = await pool.query(
      `WITH ${ORDER_SERIALS_CTE}
       SELECT
         os.*,
         s1.name AS tested_by_name,
         s2.name AS packed_by_name,
         s3.name AS tester_name
       FROM order_serials os
       LEFT JOIN staff s1 ON os.tested_by = s1.id
       LEFT JOIN staff s2 ON os.packed_by = s2.id
       LEFT JOIN staff s3 ON os.tester_id = s3.id
       WHERE RIGHT(COALESCE(os.tracking_number, ''), 8) = $1
       LIMIT 1`,
      [last8],
    );
    return result.rows[0] ?? null;
  } catch (error) {
    console.error('Error fetching shipped order by tracking:', error);
    throw new Error('Failed to fetch shipped order by tracking');
  }
}

/**
 * Get count of shipped orders
 */
export async function getShippedOrdersCount(): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COUNT(DISTINCT o.id) AS count
       FROM orders o
       JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
       WHERE stn.is_carrier_accepted OR stn.is_in_transit
          OR stn.is_out_for_delivery OR stn.is_delivered`,
    );
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error('Error counting shipped orders:', error);
    throw new Error('Failed to count shipped orders');
  }
}

// ─── Active Orders (Read) ─────────────────────────────────────────────────────

/**
 * Get active (non-shipped) orders with assignment info
 */
export async function getActiveOrders(options?: {
  status?: string;
  assignedTechId?: number;
  assignedPackerId?: number;
  weekStart?: string;
  weekEnd?: string;
  missingShipmentOnly?: boolean;
  pendingOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<ActiveOrder[]> {
  const conditions: string[] = [
    `NOT COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
       OR stn.is_out_for_delivery OR stn.is_delivered, false)`,
  ];
  const params: any[] = [];
  let idx = 1;

  if (options?.missingShipmentOnly) {
    conditions.push(`o.shipment_id IS NULL`);
  }
  if (options?.weekStart) { conditions.push(`wa_deadline.deadline_at >= $${idx++}`); params.push(options.weekStart); }
  if (options?.weekEnd) { conditions.push(`wa_deadline.deadline_at <= $${idx++}`); params.push(options.weekEnd); }
  if (options?.assignedTechId != null) {
    conditions.push(`wa_t.assigned_tech_id = $${idx++}`);
    params.push(options.assignedTechId);
  }
  if (options?.assignedPackerId != null) {
    conditions.push(`wa_p.assigned_packer_id = $${idx++}`);
    params.push(options.assignedPackerId);
  }
  if (options?.pendingOnly) {
    conditions.push(`(wa_t.assigned_tech_id IS NULL OR wa_p.assigned_packer_id IS NULL)`);
  }

  const limit = options?.limit ?? 200;
  const offset = options?.offset ?? 0;
  params.push(limit, offset);

  const result = await pool.query(
    `SELECT
       o.id,
       o.shipment_id,
       o.order_id,
       o.product_title,
       o.quantity,
       o.item_number,
       o.condition,
       stn.tracking_number_raw AS tracking_number,
       o.sku,
       o.account_source,
       o.notes,
       o.status_history,
       COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
         OR stn.is_out_for_delivery OR stn.is_delivered, false) AS is_shipped,
       stn.latest_status_category AS shipment_status,
       stn.carrier,
       to_char(wa_deadline.deadline_at, 'YYYY-MM-DD HH24:MI:SS') AS ship_by_date,
       o.out_of_stock,
       to_char(o.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
       wa_t.assigned_tech_id   AS tester_id,
       wa_p.assigned_packer_id AS packer_id,
       pl.packed_by,
       to_char(pl.packed_at, 'YYYY-MM-DD HH24:MI:SS') AS packed_at,
       COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.created_at), '') AS serial_number,
       MIN(tsn.tested_by)::int AS tested_by
     FROM orders o
     LEFT JOIN LATERAL (
       SELECT wa.deadline_at FROM work_assignments wa
       WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id AND wa.work_type = 'TEST'
       ORDER BY CASE wa.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2 WHEN 'OPEN' THEN 3 WHEN 'DONE' THEN 4 ELSE 5 END,
                wa.updated_at DESC, wa.id DESC LIMIT 1
     ) wa_deadline ON TRUE
     LEFT JOIN LATERAL (
       SELECT assigned_tech_id FROM work_assignments
       WHERE entity_type = 'ORDER' AND entity_id = o.id AND work_type = 'TEST'
         AND status IN ('ASSIGNED', 'IN_PROGRESS')
       ORDER BY created_at DESC LIMIT 1
     ) wa_t ON true
     LEFT JOIN LATERAL (
       SELECT assigned_packer_id FROM work_assignments
       WHERE entity_type = 'ORDER' AND entity_id = o.id AND work_type = 'PACK'
         AND status IN ('ASSIGNED', 'IN_PROGRESS')
       ORDER BY created_at DESC LIMIT 1
     ) wa_p ON true
     LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
     LEFT JOIN LATERAL (
       SELECT packed_by, created_at AS packed_at FROM packer_logs pl
       WHERE pl.shipment_id IS NOT NULL
         AND pl.shipment_id = o.shipment_id
         AND pl.tracking_type = 'ORDERS'
       ORDER BY pl.created_at DESC NULLS LAST, pl.id DESC LIMIT 1
     ) pl ON true
     LEFT JOIN tech_serial_numbers tsn ON tsn.shipment_id = o.shipment_id AND o.shipment_id IS NOT NULL
     WHERE ${conditions.join(' AND ')}
     GROUP BY o.id, o.shipment_id, wa_deadline.deadline_at, o.order_id, o.product_title, o.quantity,
              o.condition, o.item_number, stn.tracking_number_raw, o.sku, o.out_of_stock,
              o.account_source, o.notes, o.status_history,
              stn.is_carrier_accepted, stn.is_in_transit, stn.is_out_for_delivery, stn.is_delivered,
              stn.latest_status_category, stn.carrier,
              wa_t.assigned_tech_id, wa_p.assigned_packer_id,
              pl.packed_by, pl.packed_at
     ORDER BY wa_deadline.deadline_at ASC NULLS LAST, o.id ASC
     LIMIT $${idx++} OFFSET $${idx}`,
    params,
  );
  return result.rows;
}

// ─── Orders (Write) ───────────────────────────────────────────────────────────

/**
 * Update a specific field in a shipped order
 */
export async function updateShippedOrderField(id: number, field: string, value: any): Promise<void> {
  const allowedFields = ['notes', 'status_history'];
  if (!allowedFields.includes(field)) {
    throw new Error(
      `Field '${field}' cannot be updated here. ` +
      `Use /api/orders/assign for assignment changes, ` +
      `tech_serial_numbers for serial/test data, or packer_logs for packing completion data.`,
    );
  }
  try {
    await pool.query(
      `UPDATE orders o
       SET ${field} = $1
       FROM shipping_tracking_numbers stn
       WHERE o.id = $2
         AND stn.id = o.shipment_id
         AND (stn.is_carrier_accepted OR stn.is_in_transit
              OR stn.is_out_for_delivery OR stn.is_delivered)`,
      [value, id],
    );
  } catch (error) {
    console.error('Error updating shipped order field:', error);
    throw new Error('Failed to update shipped order field');
  }
}

/**
 * Create a new order
 */
export async function createOrder(params: CreateOrderParams): Promise<ActiveOrder> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO orders
         (order_id, product_title, sku, account_source,
          condition, quantity, item_number, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        params.orderId,
        params.productTitle,
        params.sku ?? null,
        params.accountSource ?? 'Manual',
        params.condition ?? 'Good',
        params.quantity ?? null,
        params.itemNumber ?? null,
        params.notes ?? null,
      ],
    );

    const order = result.rows[0];
    await client.query(
      `INSERT INTO work_assignments
         (entity_type, entity_id, work_type, assigned_tech_id, status, priority, deadline_at, notes, assigned_at, created_at, updated_at)
       VALUES ('ORDER', $1, 'TEST', NULL, 'OPEN', 100, $2, 'Canonical deadline row from createOrder', NOW(), NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [order.id, params.shipByDate ?? null],
    );

    await client.query('COMMIT');
    return {
      ...order,
      ship_by_date: params.shipByDate ?? null,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check if a tracking number already exists (last-8 match via shipping_tracking_numbers)
 */
export async function trackingNumberExists(trackingNumber: string): Promise<boolean> {
  const last8 = trackingNumber.replace(/\D/g, '').slice(-8);
  const result = await pool.query(
    `SELECT 1
     FROM orders o
     JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
     WHERE RIGHT(regexp_replace(stn.tracking_number_normalized, '\\D', '', 'g'), 8) = $1
     LIMIT 1`,
    [last8],
  );
  return result.rowCount ? result.rowCount > 0 : false;
}

/**
 * Update order fields (general-purpose for active orders)
 */
export async function updateOrder(
  id: number,
  updates: Partial<{
    productTitle: string;
    sku: string | null;
    condition: string;
    quantity: string | null;
    itemNumber: string | null;
    shipByDate: string | null;
    notes: string | null;
    outOfStock: string | null;
    statusHistory: any;
    accountSource: string | null;
  }>,
): Promise<ActiveOrder | null> {
  const columnMap: Record<string, string> = {
    productTitle: 'product_title',
    sku: 'sku',
    condition: 'condition',
    quantity: 'quantity',
    itemNumber: 'item_number',
    notes: 'notes',
    outOfStock: 'out_of_stock',
    statusHistory: 'status_history',
    accountSource: 'account_source',
  };

  const setClauses: string[] = [];
  const params: any[] = [];
  let idx = 1;
  const deadlineAt = updates.shipByDate;

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'shipByDate') continue;
    if (value !== undefined && columnMap[key]) {
      setClauses.push(`${columnMap[key]} = $${idx++}`);
      params.push(value);
    }
  }

  if (setClauses.length === 0 && deadlineAt === undefined) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let order: any = null;
    if (setClauses.length > 0) {
      params.push(id);
      const result = await client.query(
        `UPDATE orders SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
        params,
      );
      order = result.rows[0] ?? null;
    } else {
      const result = await client.query(`SELECT * FROM orders WHERE id = $1`, [id]);
      order = result.rows[0] ?? null;
    }

    if (!order) {
      await client.query('ROLLBACK');
      return null;
    }

    if (deadlineAt !== undefined) {
      await client.query(
        `INSERT INTO work_assignments
           (entity_type, entity_id, work_type, assigned_tech_id, status, priority, deadline_at, notes, assigned_at, created_at, updated_at)
         VALUES ('ORDER', $1, 'TEST', NULL, 'OPEN', 100, $2, 'Canonical deadline row from updateOrder', NOW(), NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [id, deadlineAt ?? null],
      );
      await client.query(
        `UPDATE work_assignments
         SET deadline_at = $1, updated_at = NOW()
         WHERE entity_type = 'ORDER'
           AND entity_id = $2
           AND work_type = 'TEST'
           AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')`,
        [deadlineAt ?? null, id],
      );
    }

    await client.query('COMMIT');
    return {
      ...order,
      ship_by_date: deadlineAt !== undefined ? (deadlineAt ?? null) : null,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Delete an order by ID
 */
export async function deleteOrder(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM orders WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Skip an order (mark with a skip status in status_history)
 */
export async function skipOrder(id: number, reason?: string): Promise<boolean> {
  const now = formatPSTTimestamp();
  const result = await pool.query(
    `UPDATE orders
     SET status_history = COALESCE(status_history, '[]'::jsonb) || $1::jsonb
     WHERE id = $2`,
    [JSON.stringify([{ status: 'SKIPPED', timestamp: now, reason: reason ?? null }]), id],
  );
  return (result.rowCount ?? 0) > 0;
}
