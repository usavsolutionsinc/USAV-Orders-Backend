import type { PoolClient } from 'pg';
import { createStationActivityLog } from '@/lib/station-activity';
import { formatPSTTimestamp } from '@/utils/date';

type Queryable = Pick<PoolClient, 'query'>;

export type TechFnskuScanApiPayload = {
  found: true;
  orderFound: false;
  techSerialId: null;
  fnskuLogId: number;
  fnskuSalId: number;
  summary: {
    tech_scanned_qty: number;
    pack_ready_qty: number;
    shipped_qty: number;
    available_to_ship: number;
  };
  shipment: {
    shipment_id: number;
    shipment_ref: string | null;
    item_id: number;
    expected_qty: number;
    actual_qty: number;
    status: string;
  } | null;
  order: {
    id: null;
    orderId: string;
    productTitle: string;
    itemNumber: null;
    sku: string;
    condition: string;
    notes: string;
    tracking: string;
    serialNumbers: string[];
    testDateTime: string;
    testedBy: number;
    accountSource: string;
    quantity: number;
    status: string | null;
    statusHistory: unknown[];
    isShipped: boolean;
    packerId: null;
    testerId: null;
    outOfStock: null;
    asin: string | null;
    shipByDate: null;
    orderDate: null;
    createdAt: string;
  };
};

/**
 * Tech FNSKU scan: inserts a new `fba_fnsku_logs` row (TECH/SCANNED) and a matching
 * `FNSKU_SCANNED` station_activity_logs row. Does not create TSN rows and does not
 * pre-fill serials from existing TSN — serials are added only when the tech scans them.
 * Does not commit.
 */
export async function performTechFnskuScan(
  client: Queryable,
  params: { fnsku: string; testedBy: number },
): Promise<TechFnskuScanApiPayload> {
  const fnsku = String(params.fnsku || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const testedBy = params.testedBy;

  const fnskuResult = await client.query(
    `SELECT fnsku, product_title, asin, sku
     FROM fba_fnskus
     WHERE fnsku = $1
     LIMIT 1`,
    [fnsku],
  );

  if (fnskuResult.rows.length === 0) {
    throw Object.assign(new Error('FNSKU not found in fba_fnskus table'), { code: 'FNSKU_NOT_FOUND' });
  }

  const meta = fnskuResult.rows[0];

  const openItemResult = await client.query(
    `SELECT
       fsi.id,
       fsi.shipment_id,
       fsi.expected_qty,
       fsi.actual_qty,
       fsi.status,
       fs.shipment_ref
     FROM fba_shipment_items fsi
     JOIN fba_shipments fs ON fs.id = fsi.shipment_id
     WHERE fsi.fnsku = $1
       AND fs.status != 'SHIPPED'
       AND fsi.status != 'SHIPPED'
     ORDER BY
       CASE fsi.status
         WHEN 'PLANNED' THEN 1
         WHEN 'READY_TO_GO' THEN 2
         WHEN 'LABEL_ASSIGNED' THEN 3
         ELSE 4
       END,
       fs.created_at ASC,
       fsi.id ASC
     LIMIT 1`,
    [fnsku],
  );
  const openItem = openItemResult.rows[0] ?? null;
  let lifecycleItem = openItem;

  if (openItem && String(openItem.status) === 'PLANNED') {
    const bumpToPacking = await client.query(
      `UPDATE fba_shipment_items
       SET status = 'PACKING'::fba_shipment_status_enum,
           ready_by_staff_id = COALESCE(ready_by_staff_id, $1),
           ready_at = COALESCE(ready_at, NOW()),
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, shipment_id, expected_qty, actual_qty, status`,
      [testedBy, openItem.id]
    );
    if (bumpToPacking.rows[0]) {
      lifecycleItem = {
        ...openItem,
        ...bumpToPacking.rows[0],
      };
    }
  }

  const fnskuLogResult = await client.query(
    `INSERT INTO fba_fnsku_logs
       (fnsku, source_stage, event_type, staff_id, tech_serial_number_id, fba_shipment_id, fba_shipment_item_id, quantity, station, notes, metadata)
     VALUES ($1, 'TECH', 'SCANNED', $2, $3, $4, $5, 1, 'TECH_STATION', $6, $7::jsonb)
     RETURNING id, created_at`,
    [
      fnsku,
      testedBy,
      null,
      lifecycleItem?.shipment_id ?? null,
      lifecycleItem?.id ?? null,
      'Tech FNSKU scan',
      JSON.stringify({
        product_title: meta.product_title ?? null,
        sku: meta.sku ?? null,
        asin: meta.asin ?? null,
        auto_linked_open_item: Boolean(openItem),
      }),
    ],
  );

  const fnskuLogId = Number(fnskuLogResult.rows[0].id);
  const logCreatedAt = fnskuLogResult.rows[0].created_at as string;

  const fnskuSalId = await createStationActivityLog(client, {
    station: 'TECH',
    activityType: 'FNSKU_SCANNED',
    staffId: testedBy,
    scanRef: fnsku,
    fnsku,
    fbaShipmentId: openItem?.shipment_id ?? null,
    fbaShipmentItemId: lifecycleItem?.id ?? null,
    notes: 'Tech FNSKU scan',
    metadata: {
      source: 'tech.perform-fnsku-scan',
      fnsku_log_id: fnskuLogId,
      product_title: meta.product_title ?? null,
      sku: meta.sku ?? null,
      asin: meta.asin ?? null,
    },
    createdAt: formatPSTTimestamp(),
  });
  if (fnskuSalId == null) {
    throw new Error('Failed to create FNSKU_SCANNED station_activity_logs row');
  }

  // Blank serial list on each FNSKU scan: TSN rows are created only when the tech scans
  // a serial (insertTechSerialForTracking), not by re-hydrating prior TSN rows for this FNSKU.

  const summaryResult = await client.query(
    `SELECT
       COALESCE(SUM(quantity) FILTER (WHERE source_stage = 'TECH' AND event_type = 'SCANNED'), 0)::int AS tech_scanned_qty,
       COALESCE(SUM(quantity) FILTER (WHERE source_stage = 'PACK' AND event_type IN ('READY', 'VERIFIED', 'BOXED')), 0)::int AS pack_ready_qty,
       COALESCE(SUM(quantity) FILTER (WHERE source_stage = 'SHIP' AND event_type = 'SHIPPED'), 0)::int AS shipped_qty
     FROM fba_fnsku_logs
     WHERE fnsku = $1
       AND event_type != 'VOID'`,
    [fnsku],
  );

  const summary = summaryResult.rows[0] || {
    tech_scanned_qty: 0,
    pack_ready_qty: 0,
    shipped_qty: 0,
  };
  const techScannedQty = Number(summary.tech_scanned_qty || 0);
  const packReadyQty = Number(summary.pack_ready_qty || 0);
  const shippedQty = Number(summary.shipped_qty || 0);

  return {
    found: true,
    orderFound: false,
    techSerialId: null,
    fnskuLogId,
    fnskuSalId,
    summary: {
      tech_scanned_qty: techScannedQty,
      pack_ready_qty: packReadyQty,
      shipped_qty: shippedQty,
      available_to_ship: Math.max(Math.min(techScannedQty, packReadyQty) - shippedQty, 0),
    },
    shipment: openItem
      ? {
          shipment_id: Number(lifecycleItem?.shipment_id ?? openItem.shipment_id),
          shipment_ref: openItem.shipment_ref ?? null,
          item_id: Number(lifecycleItem?.id ?? openItem.id),
          expected_qty: Number((lifecycleItem?.expected_qty ?? openItem.expected_qty) || 0),
          actual_qty: Number((lifecycleItem?.actual_qty ?? openItem.actual_qty) || 0),
          status: String(lifecycleItem?.status ?? openItem.status),
        }
      : null,
    order: {
      id: null,
      orderId: 'FNSKU',
      productTitle: meta.product_title || 'Unknown Product',
      itemNumber: null,
      sku: meta.sku || 'N/A',
      condition: 'N/A',
      notes: '',
      tracking: fnsku,
      serialNumbers: [],
      testDateTime: logCreatedAt,
      testedBy,
      accountSource: 'fba',
      quantity: 1,
      status: lifecycleItem?.status ?? openItem?.status ?? null,
      statusHistory: [],
      isShipped: false,
      packerId: null,
      testerId: null,
      outOfStock: null,
      asin: meta.asin || null,
      shipByDate: null,
      orderDate: null,
      createdAt: logCreatedAt,
    },
  };
}
