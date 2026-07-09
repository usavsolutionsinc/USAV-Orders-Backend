import type { Pool, PoolClient } from 'pg';

/**
 * Writer for the shipped-table read model (`packer_log_enrichment`).
 *
 * Precomputes the slowly-changing, expensive-to-resolve enrichments for a PACK
 * `station_activity_logs` row — the catalog product title (the non-indexable
 * ecwid / sku_catalog / sku_stock UNNEST+regexp laterals), the v_sku lookup, the
 * order match, and the order-tracking json — so the /api/packerlogs read query
 * (src/lib/neon/packer-logs-week.ts) can JOIN them 1:1 instead of running the
 * laterals per row on every cache miss.
 *
 * The LATERAL bodies below are copied VERBATIM from the inline read query so the
 * projected values are byte-identical to what the laterals produced; the only
 * change is they are evaluated once (on write / relink / backfill) instead of on
 * every read. Volatile fields (carrier status, staff names, deadlines, scan-out)
 * are intentionally NOT projected — the reader keeps them as live joins.
 *
 * Best-effort + idempotent: an UPSERT keyed on sal_id, safe to call repeatedly.
 * Callers fire it via `after()` so it never blocks a mutation's response.
 *
 * Tenant scope (2026-07-01): every SKU-string lateral is org-scoped by
 * `sal.organization_id` (sku_platform_ids / sku_catalog / sku_stock / orders),
 * so a SKU string that collides across orgs can no longer bleed a foreign
 * tenant's title into a row. RESIDUAL: the `v_sku` compat view (a projection of
 * serial_units that drops organization_id) can't be predicate-filtered here; its
 * SKU-string branch remains cross-org until v_sku exposes org (tracked with the
 * tech_serial_numbers / serial-spine strangle).
 */

type Queryable = Pool | PoolClient;

/** The expensive, immutable-per-scan resolution — the heavy half of the read query. */
const ENRICHMENT_SELECT = /* sql */ `
  SELECT
    sal.id                                  AS sal_id,
    sal.organization_id                     AS organization_id,
    order_match.id                          AS order_row_id,
    COALESCE(
        ecwid_lookup.ecwid_product_title,
        sku_catalog_lookup.catalog_product_title,
        sku_stock_lookup.stock_product_title
    )                                       AS external_product_title,
    sku_lookup.sku_table_id                 AS sku_table_id,
    sku_lookup.sku_table_serial             AS sku_table_serial,
    sku_lookup.sku_table_static_sku         AS sku_table_static_sku,
    COALESCE(order_trackings.tracking_numbers, '[]'::json)::jsonb      AS tracking_numbers,
    COALESCE(order_trackings.tracking_number_rows, '[]'::json)::jsonb  AS tracking_number_rows
  FROM station_activity_logs sal
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
  LEFT JOIN fba_fnskus ff ON ff.fnsku = sal.fnsku
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
`;

/**
 * Compute + upsert the enrichment for the given PACK `station_activity_logs`
 * ids. No-op on an empty list. Non-PACK ids are ignored (the WHERE gates on
 * `station = 'PACK'`), so callers can pass ids without pre-filtering.
 */
export async function computePackerLogEnrichment(
  executor: Queryable,
  salIds: number[],
): Promise<void> {
  const ids = salIds.filter((id) => Number.isFinite(id));
  if (ids.length === 0) return;

  await executor.query(
    `INSERT INTO packer_log_enrichment (
        sal_id, organization_id, order_row_id, external_product_title,
        sku_table_id, sku_table_serial, sku_table_static_sku,
        tracking_numbers, tracking_number_rows, computed_at
     )
     SELECT
        src.sal_id, src.organization_id, src.order_row_id, src.external_product_title,
        src.sku_table_id, src.sku_table_serial, src.sku_table_static_sku,
        src.tracking_numbers, src.tracking_number_rows, now()
     FROM ( ${ENRICHMENT_SELECT} WHERE sal.id = ANY($1) AND sal.station = 'PACK' ) src
     ON CONFLICT (sal_id) DO UPDATE SET
        organization_id        = EXCLUDED.organization_id,
        order_row_id           = EXCLUDED.order_row_id,
        external_product_title = EXCLUDED.external_product_title,
        sku_table_id           = EXCLUDED.sku_table_id,
        sku_table_serial       = EXCLUDED.sku_table_serial,
        sku_table_static_sku   = EXCLUDED.sku_table_static_sku,
        tracking_numbers       = EXCLUDED.tracking_numbers,
        tracking_number_rows   = EXCLUDED.tracking_number_rows,
        computed_at            = now()`,
    [ids],
  );
}

/**
 * Recompute enrichment for every PACK scan affected by a change to the given
 * order id(s) — used by order create / assign / delete. Targets scans that are
 * EITHER currently projected onto one of these orders (enr.order_row_id) OR share
 * its shipment (so a newly-linked or unlinked order re-resolves its `order_match`
 * here). Tolerates already-deleted orders: the order_row_id branch still finds
 * the scans that pointed at them so their match falls back correctly.
 */
export async function recomputeEnrichmentForOrders(
  executor: Queryable,
  orderIds: ReadonlyArray<unknown>,
): Promise<void> {
  const ids = orderIds
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 0) return;

  const sal = await executor.query(
    `SELECT sal.id
       FROM station_activity_logs sal
      WHERE sal.station = 'PACK'
        AND (
          sal.shipment_id IN (
            SELECT shipment_id FROM orders WHERE id = ANY($1) AND shipment_id IS NOT NULL
          )
          OR sal.id IN (
            SELECT sal_id FROM packer_log_enrichment WHERE order_row_id = ANY($1)
          )
        )`,
    [ids],
  );
  const salIds = sal.rows.map((r: { id: number }) => r.id);
  await computePackerLogEnrichment(executor, salIds);
}
