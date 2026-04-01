#!/usr/bin/env node
require('dotenv').config({ path: '.env', quiet: true });
const { Client } = require('pg');

function normalizeKey18(value) {
  const key = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return key.length > 18 ? key.slice(-18) : key;
}

async function main() {
  const orderId = process.argv[2] || '112-9690359-6079404';
  const tracking = process.argv[3] || '1ZJ22B104223852804';
  const key18 = normalizeKey18(tracking);

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  });

  await client.connect();

  const orderAndLinks = await client.query(
    `
      SELECT
        o.id,
        o.order_id,
        o.shipment_id AS primary_shipment_id,
        stn_primary.tracking_number_raw AS primary_tracking,
        COALESCE(
          json_agg(
            json_build_object(
              'shipment_id', osl.shipment_id,
              'tracking', stn_link.tracking_number_raw,
              'is_primary', osl.is_primary
            )
            ORDER BY CASE WHEN osl.is_primary THEN 0 ELSE 1 END, osl.shipment_id
          ) FILTER (WHERE osl.shipment_id IS NOT NULL),
          '[]'::json
        ) AS links
      FROM orders o
      LEFT JOIN shipping_tracking_numbers stn_primary ON stn_primary.id = o.shipment_id
      LEFT JOIN order_shipment_links osl ON osl.order_row_id = o.id
      LEFT JOIN shipping_tracking_numbers stn_link ON stn_link.id = osl.shipment_id
      WHERE o.order_id = $1
      GROUP BY o.id, o.order_id, o.shipment_id, stn_primary.tracking_number_raw
    `,
    [orderId],
  );

  const routeSimulation = await client.query(
    `
      SELECT
        sal.id AS sal_id,
        sal.station,
        sal.activity_type,
        sal.shipment_id AS sal_shipment_id,
        stn.tracking_number_raw AS sal_tracking,
        ord_match.order_id,
        COALESCE(order_trackings.tracking_numbers, '[]'::json) AS tracking_numbers
      FROM station_activity_logs sal
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
      LEFT JOIN LATERAL (
        SELECT o.id, o.order_id, o.created_at
        FROM orders o
        LEFT JOIN order_shipment_links osl ON osl.order_row_id = o.id
        WHERE sal.shipment_id IS NOT NULL
          AND (
            osl.shipment_id = sal.shipment_id
            OR o.shipment_id = sal.shipment_id
          )
        ORDER BY
          CASE
            WHEN osl.shipment_id = sal.shipment_id THEN 0
            WHEN o.shipment_id = sal.shipment_id THEN 1
            ELSE 2
          END,
          CASE WHEN COALESCE(osl.is_primary, false) THEN 0 ELSE 1 END,
          o.created_at DESC NULLS LAST,
          o.id DESC
        LIMIT 1
      ) ord_match ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          json_agg(t.tracking_number_raw ORDER BY t.sort_key, t.tracking_number_raw)
            FILTER (WHERE COALESCE(t.tracking_number_raw, '') <> ''),
          '[]'::json
        ) AS tracking_numbers
        FROM (
          SELECT DISTINCT
            stn_link.tracking_number_raw,
            CASE WHEN COALESCE(osl_link.is_primary, false) THEN 0 ELSE 1 END AS sort_key
          FROM order_shipment_links osl_link
          LEFT JOIN shipping_tracking_numbers stn_link ON stn_link.id = osl_link.shipment_id
          WHERE ord_match.id IS NOT NULL
            AND osl_link.order_row_id = ord_match.id

          UNION

          SELECT DISTINCT
            stn_primary.tracking_number_raw,
            0 AS sort_key
          FROM orders o_primary
          LEFT JOIN shipping_tracking_numbers stn_primary ON stn_primary.id = o_primary.shipment_id
          WHERE ord_match.id IS NOT NULL
            AND o_primary.id = ord_match.id
        ) t
      ) order_trackings ON TRUE
      WHERE sal.station IN ('TECH', 'PACK')
        AND RIGHT(
          regexp_replace(UPPER(COALESCE(stn.tracking_number_raw, sal.scan_ref, '')), '[^A-Z0-9]', '', 'g'),
          18
        ) = $1
      ORDER BY sal.created_at DESC
      LIMIT 20
    `,
    [key18],
  );

  await client.end();

  const orderRow = orderAndLinks.rows[0] || null;
  const links = Array.isArray(orderRow?.links) ? orderRow.links : [];
  const linkTrackings = links
    .map((r) => String(r?.tracking || '').trim())
    .filter(Boolean);
  const uniqueLinkTrackings = Array.from(new Set(linkTrackings));

  const simRows = routeSimulation.rows || [];
  const simHasOrder = simRows.some((r) => String(r.order_id || '').trim() === orderId);
  const simHasBothTrackings = simRows.some((r) => {
    const arr = Array.isArray(r.tracking_numbers) ? r.tracking_numbers : [];
    const normalized = arr.map((x) => String(x || '').trim()).filter(Boolean);
    return uniqueLinkTrackings.every((t) => normalized.includes(t));
  });

  const pass = Boolean(orderRow)
    && uniqueLinkTrackings.length >= 2
    && simHasOrder
    && simHasBothTrackings;

  console.log(JSON.stringify({
    input: { orderId, tracking },
    checks: {
      orderFound: Boolean(orderRow),
      linkedTrackingCount: uniqueLinkTrackings.length,
      linkedTrackings: uniqueLinkTrackings,
      routeRows: simRows.length,
      routeResolvesOrder: simHasOrder,
      routeReturnsAllTrackings: simHasBothTrackings,
    },
    pass,
  }, null, 2));

  process.exit(pass ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
