#!/usr/bin/env node
/**
 * Sync Ecwid incoming repair orders into repair_service.
 *
 * Filters:
 * - At least one item SKU ending with "-RS"
 * - payment status = PAID
 * - fulfillment status = AWAITING_PROCESSING (or close equivalent)
 * - not shipped
 *
 * Usage:
 *   node scripts/sync-ecwid-incoming-repairs.js
 *   node scripts/sync-ecwid-incoming-repairs.js --max-pages 20
 *   node scripts/sync-ecwid-incoming-repairs.js --dry-run
 */

require('dotenv').config();
const { Pool } = require('pg');

const ECWID_BASE_URL = 'https://app.ecwid.com/api/v3';
const PAGE_LIMIT = 100;

function requiredEnvAny(primaryName, aliases = []) {
  const keys = [primaryName, ...aliases];
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  throw new Error(`Missing required environment variable: ${primaryName}`);
}

function parseArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  const next = process.argv[idx + 1];
  return next == null ? fallback : next;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function normalizeStatus(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseEcwidOrderDate(value) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isRepairServiceSku(value) {
  return String(value || '').trim().toUpperCase().endsWith('-RS');
}

function extractTrackingNumber(order) {
  const candidates = [
    order?.trackingNumber,
    order?.shippingTrackingNumber,
    order?.shippingInfo?.trackingNumber,
    order?.shippingInfo?.tracking,
  ];

  if (Array.isArray(order?.shipments)) {
    for (const shipment of order.shipments) {
      candidates.push(shipment?.trackingNumber, shipment?.tracking, shipment?.trackingCode);
    }
  }

  for (const candidate of candidates) {
    const text = String(candidate || '').trim();
    if (!text) continue;
    const split = text
      .split(/[\n,]+/)
      .map((part) => String(part || '').trim())
      .filter(Boolean);
    if (split.length > 0) return split[0];
  }

  return null;
}

function extractEcwidContactInfo(order) {
  const parts = [
    String(order?.shippingPerson?.name || order?.billingPerson?.name || order?.email || '').trim(),
    String(order?.shippingPerson?.phone || order?.billingPerson?.phone || '').trim(),
    String(order?.email || '').trim(),
  ].filter(Boolean);
  return parts.join(', ');
}

function buildEcwidRepairNotes({ existingNotes, trackingNumber, orderId, sku }) {
  const parts = [
    orderId ? `Ecwid Order: ${orderId}` : null,
    trackingNumber ? `Tracking: ${trackingNumber}` : null,
    sku ? `Source SKU: ${sku}` : null,
  ].filter(Boolean);

  const prefix = parts.join('\n');
  const existing = String(existingNotes || '').trim();
  if (!prefix) return existing || null;
  if (!existing) return prefix;
  return `${prefix}\n\n${existing}`;
}

function getEcwidPaymentStatus(order) {
  return normalizeStatus(
    order?.paymentStatus ??
    order?.paymentStatusValue ??
    order?.paymentStatusName ??
    order?.payment?.status ??
    ''
  );
}

function getEcwidFulfillmentStatus(order) {
  return normalizeStatus(
    order?.fulfillmentStatus ??
    order?.fulfilmentStatus ??
    order?.shippingStatus ??
    order?.shipping?.status ??
    ''
  );
}

function isEligibleIncomingOrder(order) {
  const payment = getEcwidPaymentStatus(order);
  const fulfillment = getEcwidFulfillmentStatus(order);
  const paid = payment === 'PAID';
  const awaitingProcessing = fulfillment === 'AWAITING_PROCESSING' || fulfillment === 'AWAITING_FULFILLMENT';
  const notShipped = fulfillment !== 'SHIPPED' && fulfillment !== 'DELIVERED';
  return paid && awaitingProcessing && notShipped;
}

async function fetchEcwidOrders(storeId, token, maxPages) {
  const items = [];
  let offset = 0;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(`${ECWID_BASE_URL}/${storeId}/orders`);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(PAGE_LIMIT));

    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ecwid orders request failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    const pageItems = Array.isArray(data?.items) ? data.items : [];
    items.push(...pageItems);

    if (pageItems.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }

  return items;
}

async function upsertIncomingRepair(client, params) {
  const existing = await client.query(
    `SELECT id
     FROM repair_service
     WHERE source_system = 'ecwid'
       AND (
         (
           source_order_id IS NOT NULL
           AND source_order_id = $1
           AND (
             COALESCE(NULLIF($3, ''), '') = ''
             OR COALESCE(source_sku, '') = COALESCE($3, '')
           )
         )
         OR (
           source_tracking_number IS NOT NULL
           AND source_tracking_number = $2
           AND COALESCE(source_sku, '') = COALESCE($3, '')
         )
       )
     ORDER BY id DESC
     LIMIT 1`,
    [params.orderId, params.trackingNumber, params.sku]
  );

  const notes = buildEcwidRepairNotes({
    existingNotes: params.notes,
    trackingNumber: params.trackingNumber,
    orderId: params.orderId,
    sku: params.sku,
  });

  if (existing.rows.length > 0) {
    const repairId = Number(existing.rows[0].id);
    await client.query(
      `UPDATE repair_service
       SET contact_info = COALESCE(NULLIF(contact_info, ''), $1),
           product_title = COALESCE(NULLIF(product_title, ''), $2),
           price = COALESCE(NULLIF(price, ''), $3),
           notes = COALESCE(NULLIF(notes, ''), $4),
           source_order_id = COALESCE(NULLIF(source_order_id, ''), $5),
           source_tracking_number = COALESCE(NULLIF(source_tracking_number, ''), $6),
           source_sku = COALESCE(NULLIF(source_sku, ''), $7),
           intake_channel = COALESCE(NULLIF(intake_channel, ''), 'shipment'),
           incoming_status = CASE
             WHEN COALESCE(incoming_status, '') IN ('', 'pending_repair') THEN 'incoming'
             ELSE incoming_status
           END,
           delivered_at = COALESCE(delivered_at, $8),
           updated_at = NOW()
       WHERE id = $9`,
      [
        params.contactInfo ?? null,
        params.productTitle ?? null,
        params.price ?? null,
        notes,
        params.orderId ?? null,
        params.trackingNumber ?? null,
        params.sku ?? null,
        params.orderDate ?? null,
        repairId,
      ]
    );
    return { id: repairId, mode: 'updated' };
  }

  const insertResult = await client.query(
    `INSERT INTO repair_service
       (
         created_at, updated_at, ticket_number, contact_info, product_title, price, issue, serial_number, notes, status,
         source_system, source_order_id, source_tracking_number, source_sku, intake_channel, incoming_status,
         delivered_at, received_at, intake_confirmed_at, received_by_staff_id
       )
     VALUES ($1, $1, NULL, $2, $3, $4, 'Ecwid inbound repair shipment', '', $5, 'Incoming Shipment', 'ecwid', $6, $7, $8, 'shipment', 'incoming', $9, NULL, NULL, NULL)
     RETURNING id, ticket_number`,
    [
      params.orderDate ?? new Date().toISOString(),
      params.contactInfo || '',
      params.productTitle || 'Ecwid Incoming Repair',
      params.price || '',
      notes,
      params.orderId ?? null,
      params.trackingNumber ?? null,
      params.sku ?? null,
      params.orderDate ?? null,
    ]
  );

  const id = Number(insertResult.rows[0].id);
  let ticketNumber = insertResult.rows[0].ticket_number;

  if (!ticketNumber) {
    const fallback = `RS-${String(id).padStart(4, '0')}`;
    await client.query(
      'UPDATE repair_service SET ticket_number = $1, updated_at = NOW() WHERE id = $2',
      [fallback, id]
    );
  }

  return { id, mode: 'created' };
}

async function main() {
  const maxPages = Math.max(1, Math.min(100, Number(parseArg('--max-pages', '20')) || 20));
  const dryRun = hasFlag('--dry-run');

  const ecwidStoreId = requiredEnvAny('ECWID_STORE_ID', [
    'ECWID_STOREID',
    'ECWID_STORE',
    'NEXT_PUBLIC_ECWID_STORE_ID',
  ]);
  const ecwidApiToken = requiredEnvAny('ECWID_API_TOKEN', [
    'ECWID_TOKEN',
    'ECWID_ACCESS_TOKEN',
    'NEXT_PUBLIC_ECWID_API_TOKEN',
  ]);
  const databaseUrl = requiredEnvAny('DATABASE_URL');

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  const totals = {
    scannedOrders: 0,
    eligibleOrders: 0,
    repairItems: 0,
    created: 0,
    updated: 0,
    skippedNoRsSku: 0,
    skippedStatus: 0,
    failed: 0,
  };

  const statusPairs = new Map();
  const touchedIds = new Set();

  try {
    console.log(`Fetching Ecwid orders (maxPages=${maxPages})...`);
    const orders = await fetchEcwidOrders(ecwidStoreId, ecwidApiToken, maxPages);
    totals.scannedOrders = orders.length;
    console.log(`Fetched ${orders.length} Ecwid orders`);

    const client = await pool.connect();
    try {
      if (!dryRun) await client.query('BEGIN');

      for (const order of orders) {
        const payment = getEcwidPaymentStatus(order) || 'UNKNOWN';
        const fulfillment = getEcwidFulfillmentStatus(order) || 'UNKNOWN';
        const pairKey = `${payment}|${fulfillment}`;
        statusPairs.set(pairKey, (statusPairs.get(pairKey) || 0) + 1);

        const rsItems = (Array.isArray(order?.items) ? order.items : []).filter((item) =>
          isRepairServiceSku(item?.sku)
        );
        if (rsItems.length === 0) {
          totals.skippedNoRsSku += 1;
          continue;
        }

        if (!isEligibleIncomingOrder(order)) {
          totals.skippedStatus += 1;
          continue;
        }

        totals.eligibleOrders += 1;

        const orderId = String(order?.orderNumber ?? order?.id ?? '').trim() || null;
        const trackingNumber = extractTrackingNumber(order);
        const contactInfo = extractEcwidContactInfo(order) || null;
        const orderDate = parseEcwidOrderDate(order?.createDate ?? order?.created ?? order?.date);
        const customerNotes = String(order?.customerComments || order?.orderComments || '').trim() || null;

        for (const item of rsItems) {
          totals.repairItems += 1;
          const price = item?.price == null ? '' : String(item.price).trim();
          const result = dryRun
            ? { id: -1, mode: 'updated' }
            : await upsertIncomingRepair(client, {
                orderId,
                trackingNumber,
                sku: String(item?.sku || '').trim() || null,
                productTitle: String(item?.name || '').trim() || null,
                contactInfo,
                price: price || null,
                orderDate: orderDate ? orderDate.toISOString() : null,
                notes: customerNotes,
              });

          if (result.mode === 'created') totals.created += 1;
          else totals.updated += 1;
          if (result.id > 0) touchedIds.add(result.id);
        }
      }

      if (dryRun) {
        console.log('Dry run mode: rolling back transaction');
        await client.query('ROLLBACK');
      } else {
        await client.query('COMMIT');
      }
    } catch (error) {
      totals.failed += 1;
      if (!dryRun) {
        try { await client.query('ROLLBACK'); } catch {}
      }
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  console.log('\nSync complete');
  console.log(JSON.stringify({ dryRun, ...totals, touchedRepairs: touchedIds.size }, null, 2));

  const topStatusPairs = Array.from(statusPairs.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([key, count]) => {
      const [payment, fulfillment] = key.split('|');
      return { payment, fulfillment, count };
    });
  console.log('\nTop Ecwid payment/fulfillment status pairs:');
  console.log(JSON.stringify(topStatusPairs, null, 2));
}

main().catch((error) => {
  console.error('Ecwid incoming repair sync failed:', error?.message || error);
  process.exit(1);
});
