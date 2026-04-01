import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getApiIdempotencyResponse, readIdempotencyKey, saveApiIdempotencyResponse } from '@/lib/api-idempotency';
import { createStationScanSession } from '@/lib/station-scan-session';
import { normalizeTrackingKey18, normalizeTrackingLast8 } from '@/lib/tracking-format';
import { upsertOpenOrderException } from '@/lib/orders-exceptions';
import { checkRateLimit } from '@/lib/api-guard';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { formatPSTTimestamp } from '@/utils/date';
import { publishActivityLogged, publishOrderTested, publishTechLogChanged } from '@/lib/realtime/publish';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { createStationActivityLog } from '@/lib/station-activity';
import { looksLikeFnsku } from '@/lib/scan-resolver';
import { mergeSerialsFromTsnRows } from '@/lib/tech/serialFields';
import { createFbaLog } from '@/lib/fba/createFbaLog';

const ROUTE = 'tech.scan';
type ScanSourceStation = 'TECH' | 'FBA';

function resolveScanSourceStation(value: unknown): ScanSourceStation {
  return String(value || '').trim().toUpperCase() === 'FBA' ? 'FBA' : 'TECH';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveStaff(db: typeof pool, techId: number) {
  const r = await db.query(`SELECT id, name FROM staff WHERE id = $1 LIMIT 1`, [techId]);
  return r.rows[0] as { id: number; name: string } | undefined;
}

async function findOrderByShipment(
  db: typeof pool,
  shipmentId: number | null,
  key18: string | null,
  last8: string | null,
) {
  if (!shipmentId && !key18 && !last8) return null;
  const r = await db.query(
    `SELECT
       o.id, o.shipment_id, o.order_id, o.product_title, o.item_number, o.sku,
       o.condition, o.notes, o.account_source, o.status, o.status_history,
       o.out_of_stock, o.order_date, o.created_at, o.quantity,
       COALESCE(stn.tracking_number_raw, '') AS shipping_tracking_number,
       COALESCE(stn.is_carrier_accepted OR stn.is_in_transit OR stn.is_out_for_delivery OR stn.is_delivered, false) AS is_shipped,
       to_char(wa_d.deadline_at, 'YYYY-MM-DD') AS ship_by_date,
       wa_t.assigned_tech_id AS tester_id,
       wa_p.assigned_packer_id AS packer_id
     FROM orders o
     LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
     LEFT JOIN LATERAL (
       SELECT wa.deadline_at FROM work_assignments wa
       WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id AND wa.work_type = 'TEST'
       ORDER BY CASE wa.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2 WHEN 'OPEN' THEN 3 WHEN 'DONE' THEN 4 ELSE 5 END,
                wa.updated_at DESC, wa.id DESC LIMIT 1
     ) wa_d ON TRUE
     LEFT JOIN LATERAL (
       SELECT assigned_tech_id FROM work_assignments
       WHERE entity_type = 'ORDER' AND entity_id = o.id AND work_type = 'TEST' AND status NOT IN ('CANCELED','DONE')
       ORDER BY id DESC LIMIT 1
     ) wa_t ON TRUE
     LEFT JOIN LATERAL (
       SELECT assigned_packer_id FROM work_assignments
       WHERE entity_type = 'ORDER' AND entity_id = o.id AND work_type = 'PACK' AND status NOT IN ('CANCELED','DONE')
       ORDER BY id DESC LIMIT 1
     ) wa_p ON TRUE
     WHERE ($1::bigint IS NOT NULL AND o.shipment_id = $1)
        OR (stn.id IS NOT NULL AND $2::text IS NOT NULL
            AND RIGHT(regexp_replace(UPPER(COALESCE(stn.tracking_number_normalized,'')), '[^A-Z0-9]', '', 'g'), 18) = $2)
        OR (stn.id IS NOT NULL AND $3::text IS NOT NULL
            AND RIGHT(regexp_replace(COALESCE(stn.tracking_number_normalized,''), '[^0-9]', '', 'g'), 8) = $3)
     ORDER BY
       CASE
         WHEN $1::bigint IS NOT NULL AND o.shipment_id = $1 THEN 0
         WHEN stn.id IS NOT NULL AND $2::text IS NOT NULL
           AND RIGHT(regexp_replace(UPPER(COALESCE(stn.tracking_number_normalized,'')), '[^A-Z0-9]', '', 'g'), 18) = $2 THEN 1
         WHEN stn.id IS NOT NULL AND $3::text IS NOT NULL
           AND RIGHT(regexp_replace(COALESCE(stn.tracking_number_normalized,''), '[^0-9]', '', 'g'), 8) = $3 THEN 2
         ELSE 3
       END,
       o.id DESC
     LIMIT 1`,
    [shipmentId, key18, last8],
  );
  return r.rows[0] ?? null;
}

/** Get existing serials linked to a SAL anchor row. */
async function getSerialsBySalId(db: typeof pool, salId: number): Promise<string[]> {
  const r = await db.query(
    `SELECT serial_number FROM tech_serial_numbers
     WHERE context_station_activity_log_id = $1 ORDER BY id`,
    [salId],
  );
  return mergeSerialsFromTsnRows(r.rows);
}

/** Find existing FNSKU in catalog. */
async function findFnsku(db: typeof pool, fnsku: string) {
  const r = await db.query(
    `SELECT fnsku, product_title, asin, sku FROM fba_fnskus WHERE UPPER(TRIM(fnsku)) = $1 LIMIT 1`,
    [fnsku.toUpperCase().trim()],
  );
  return r.rows[0] ?? null;
}

/** Ensure FNSKU exists in catalog; creates a stub row when missing. */
async function ensureFnskuCatalog(db: typeof pool, fnsku: string) {
  const normalized = fnsku.toUpperCase().trim();
  const existing = await findFnsku(db, normalized);
  if (existing) {
    await db.query(
      `UPDATE fba_fnskus
       SET is_active = TRUE, last_seen_at = NOW(), updated_at = NOW()
       WHERE fnsku = $1`,
      [normalized],
    );
    return { catalog: existing, catalogCreated: false };
  }

  const inserted = await db.query(
    `INSERT INTO fba_fnskus (fnsku, product_title, asin, sku, is_active, last_seen_at, updated_at)
     VALUES ($1, NULL, NULL, NULL, TRUE, NOW(), NOW())
     ON CONFLICT (fnsku) DO UPDATE
       SET is_active = TRUE, last_seen_at = NOW(), updated_at = NOW()
     RETURNING fnsku, product_title, asin, sku`,
    [normalized],
  );

  return {
    catalog: inserted.rows[0] ?? { fnsku: normalized, product_title: null, asin: null, sku: null },
    catalogCreated: true,
  };
}

/** Find open FBA shipment item for this FNSKU. */
async function findOpenFbaItem(db: typeof pool, fnsku: string) {
  const r = await db.query(
    `SELECT si.id AS item_id, si.shipment_id AS shipment_id,
            fs.shipment_ref, si.expected_qty, si.actual_qty, si.status
     FROM fba_shipment_items si
     JOIN fba_shipments fs ON fs.id = si.shipment_id
     WHERE si.fnsku = $1 AND fs.status IN ('PLANNED','READY_TO_GO','LABEL_ASSIGNED')
     ORDER BY fs.created_at DESC, si.id DESC LIMIT 1`,
    [fnsku.toUpperCase().trim()],
  );
  return r.rows[0] ?? null;
}

/** Count FBA lifecycle stages for this FNSKU. */
async function fnskuStageCounts(db: typeof pool, fnsku: string) {
  const r = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE source_stage = 'TECH'  AND event_type = 'SCANNED') AS tech_scanned_qty,
       COUNT(*) FILTER (WHERE source_stage = 'PACK'  AND event_type = 'READY')   AS pack_ready_qty,
       COUNT(*) FILTER (WHERE source_stage = 'SHIP'  AND event_type = 'SHIPPED') AS shipped_qty
     FROM fba_fnsku_logs WHERE fnsku = $1`,
    [fnsku.toUpperCase().trim()],
  );
  const row = r.rows[0] ?? {};
  const tech = Number(row.tech_scanned_qty) || 0;
  const pack = Number(row.pack_ready_qty) || 0;
  const shipped = Number(row.shipped_qty) || 0;
  return { tech_scanned_qty: tech, pack_ready_qty: pack, shipped_qty: shipped, available_to_ship: tech - shipped };
}

function buildOrderPayload(row: any, overrides: Record<string, unknown> = {}) {
  return {
    id: row?.id ?? null,
    orderId: row?.order_id || 'N/A',
    productTitle: row?.product_title || 'Unknown Product',
    itemNumber: row?.item_number || null,
    sku: row?.sku || 'N/A',
    condition: row?.condition || 'N/A',
    notes: row?.notes || '',
    tracking: row?.shipping_tracking_number || '',
    serialNumbers: [] as string[],
    testDateTime: null as string | null,
    testedBy: null as number | null,
    accountSource: row?.account_source || null,
    quantity: row?.quantity || 1,
    status: row?.status || null,
    statusHistory: row?.status_history || [],
    isShipped: row?.is_shipped || false,
    packerId: row?.packer_id || null,
    testerId: row?.tester_id || null,
    outOfStock: row?.out_of_stock || null,
    shipByDate: row?.ship_by_date || null,
    orderDate: row?.order_date || null,
    createdAt: row?.created_at || null,
    ...overrides,
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const rate = checkRateLimit({ headers: req.headers, routeKey: 'tech-scan', limit: 120, windowMs: 60_000 });
  if (!rate.ok) {
    return NextResponse.json({ success: false, found: false, error: 'Rate limit exceeded' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, found: false, error: 'Invalid JSON' }, { status: 400 });

  const value = String(body.value || body.tracking || '').trim();
  const techId = Number(body.techId);
  const sourceStation = resolveScanSourceStation(body.sourceStation);
  const stationSource = sourceStation === 'FBA' ? 'fba.scan' : ROUTE;
  const salStation = sourceStation;
  const isFbaSource = sourceStation === 'FBA';
  if (!value) return NextResponse.json({ success: false, found: false, error: 'Scan value is required' }, { status: 400 });
  if (!techId) return NextResponse.json({ success: false, found: false, error: 'Tech ID is required' }, { status: 400 });

  // Explicit type override or auto-detect
  const explicitType = String(body.type || '').toUpperCase();
  const isFnsku = explicitType === 'FNSKU' || (!explicitType && looksLikeFnsku(value));
  const scanType = isFnsku ? 'FNSKU' : (explicitType || 'TRACKING');

  const idemKey = readIdempotencyKey(req, body.idempotencyKey);
  if (idemKey) {
    const hit = await getApiIdempotencyResponse(pool, idemKey, ROUTE);
    if (hit?.status_code === 200) return NextResponse.json(hit.response_body);
  }

  try {
    const staff = await resolveStaff(pool, techId);
    if (!staff) return NextResponse.json({ success: false, found: false, error: 'Staff not found' }, { status: 404 });
    const testedBy = staff.id;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // ── FNSKU path ─────────────────────────────────────────────────────
      if (scanType === 'FNSKU') {
        const fnsku = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const { catalog, catalogCreated } = await ensureFnskuCatalog(client as any, fnsku);

        const testDateTime = formatPSTTimestamp();
        const fbaItem = await findOpenFbaItem(client as any, fnsku);

        // 1. SAL row (SoT)
        const salId = await createStationActivityLog(client, {
          station: salStation,
          activityType: 'FNSKU_SCANNED',
          staffId: testedBy,
          fnsku,
          fbaShipmentId: fbaItem?.shipment_id ?? null,
          fbaShipmentItemId: fbaItem?.item_id ?? null,
          notes: isFbaSource ? 'FBA workspace FNSKU scan' : 'Tech FNSKU scan',
          metadata: { source: stationSource, product_title: catalog.product_title, sku: catalog.sku, asin: catalog.asin },
          createdAt: testDateTime,
        });

        // 2. fba_fnsku_logs row (FK to SAL)
        const fnskuLogId = await createFbaLog(client, {
          fnsku,
          sourceStage: isFbaSource ? 'FBA' : 'TECH',
          eventType: 'SCANNED',
          staffId: testedBy,
          stationActivityLogId: salId!,
          fbaShipmentId: fbaItem?.shipment_id ?? null,
          fbaShipmentItemId: fbaItem?.item_id ?? null,
          station: isFbaSource ? 'FBA_WORKSPACE' : 'TECH_STATION',
          notes: isFbaSource ? 'FBA workspace FNSKU scan' : undefined,
          metadata: { source: stationSource, product_title: catalog.product_title, sku: catalog.sku, asin: catalog.asin },
        });

        // Get existing serials for this session
        const serials = salId ? await getSerialsBySalId(client as any, salId) : [];
        const summary = await fnskuStageCounts(client as any, fnsku);

        await client.query('COMMIT');
        await invalidateCacheTags(isFbaSource ? ['fba-stage-counts'] : ['orders', 'orders-next', 'tech-logs']);
        if (!isFbaSource) {
          await publishTechLogChanged({ techId: testedBy, action: 'insert', rowId: fnskuLogId!, source: ROUTE });
        }
        if (salId) publishActivityLogged({ id: salId, station: salStation, activityType: 'FNSKU_SCANNED', staffId: testedBy, scanRef: null, fnsku, source: stationSource }).catch(() => {});

        const scanSessionId = await createStationScanSession(pool, {
          staffId: testedBy,
          sessionKind: 'FNSKU',
          fnsku,
          trackingRaw: fnsku,
          trackingKey18: normalizeTrackingKey18(fnsku),
          scanRef: fnsku,
        });

        const out = {
          success: true,
          found: true,
          orderFound: false,
          catalogCreated,
          catalogMessage: catalogCreated
            ? 'Added to catalog. You can fill in product details later.'
            : null,
          salId,
          fnskuLogId,
          techActivityId: salId,
          scanSessionId,
          summary,
          shipment: fbaItem ? {
            shipment_id: fbaItem.shipment_id,
            shipment_ref: fbaItem.shipment_ref ?? null,
            item_id: fbaItem.item_id,
            expected_qty: fbaItem.expected_qty,
            actual_qty: fbaItem.actual_qty,
            status: fbaItem.status,
          } : null,
          order: buildOrderPayload(null, {
            orderId: 'FNSKU',
            productTitle: catalog.product_title || fnsku,
            sku: catalog.sku || 'N/A',
            condition: 'FBA Scan',
            tracking: fnsku,
            serialNumbers: serials,
            testDateTime,
            testedBy,
            accountSource: 'fba',
            asin: catalog.asin || null,
            createdAt: testDateTime,
          }),
        };
        if (idemKey) await saveApiIdempotencyResponse(pool, { idempotencyKey: idemKey, route: ROUTE, staffId: testedBy, statusCode: 200, responseBody: out });
        return NextResponse.json(out);
      }

      // ── TRACKING path ──────────────────────────────────────────────────
      const resolved = await resolveShipmentId(value);
      const key18 = normalizeTrackingKey18(value);
      const last8Raw = normalizeTrackingLast8(value);
      const last8 = /^\d{8}$/.test(last8Raw) && !looksLikeFnsku(value) ? last8Raw : null;
      const order = await findOrderByShipment(client as any, resolved.shipmentId, key18, last8);

      if (!order) {
        // No order found — create exception + SAL
        let ordersExceptionId: number | null = null;
        const upsertResult = await upsertOpenOrderException({
          shippingTrackingNumber: value,
          sourceStation: isFbaSource ? 'fba' : 'tech',
          staffId: testedBy,
          staffName: staff.name,
          reason: 'not_found',
          notes: isFbaSource ? 'FBA scan: tracking not found in orders' : 'Tech scan: tracking not found in orders',
        }, client);
        ordersExceptionId = upsertResult.exception?.id ?? null;

        const testDateTime = formatPSTTimestamp();
        const salId = await createStationActivityLog(client, {
          station: salStation,
          activityType: 'TRACKING_SCANNED',
          staffId: testedBy,
          shipmentId: resolved.shipmentId ?? null,
          scanRef: resolved.scanRef ?? value,
          ordersExceptionId,
          notes: isFbaSource ? 'FBA tracking scan without matched order' : 'Tracking scan without matched order',
          metadata: { source: stationSource, order_found: false, tracking: value },
          createdAt: testDateTime,
        });

        await client.query('COMMIT');
        await invalidateCacheTags(isFbaSource ? ['fba-stage-counts'] : ['orders', 'orders-next', 'tech-logs']);
        if (salId && !isFbaSource) await publishTechLogChanged({ techId: testedBy, action: 'insert', rowId: salId, source: ROUTE });
        if (salId) publishActivityLogged({ id: salId, station: salStation, activityType: 'TRACKING_SCANNED', staffId: testedBy, scanRef: resolved.scanRef ?? value, fnsku: null, source: stationSource }).catch(() => {});

        const scanSessionId = await createStationScanSession(pool, {
          staffId: testedBy,
          sessionKind: 'EXCEPTION',
          shipmentId: resolved.shipmentId ?? null,
          ordersExceptionId,
          trackingKey18: key18,
          trackingRaw: value,
          scanRef: resolved.scanRef ?? value,
        });

        const out = {
          success: true,
          found: true,
          orderFound: false,
          salId,
          techActivityId: salId,
          scanSessionId,
          warning: 'Tracking number not found in orders. Added to exceptions.',
          order: buildOrderPayload(null, {
            tracking: value,
            testDateTime,
            testedBy,
            notes: 'Tracking recorded in orders_exceptions for reconciliation',
          }),
        };
        if (idemKey) await saveApiIdempotencyResponse(pool, { idempotencyKey: idemKey, route: ROUTE, staffId: testedBy, statusCode: 200, responseBody: out });
        return NextResponse.json(out);
      }

      // Order found — create/update SAL
      const matchedShipmentId = order.shipment_id != null ? Number(order.shipment_id) : (resolved.shipmentId ?? null);
      const trackingValue = order.shipping_tracking_number || value;
      const testDateTime = formatPSTTimestamp();

      const salId = await createStationActivityLog(client, {
        station: salStation,
        activityType: 'TRACKING_SCANNED',
        staffId: testedBy,
        shipmentId: matchedShipmentId,
        scanRef: resolved.scanRef ?? value,
        metadata: { source: stationSource, order_found: true, order_id: order.order_id, tracking: trackingValue },
        createdAt: testDateTime,
      });

      // Get existing serials for this shipment (via any SAL row for same shipment)
      const existingSerials = salId ? await getSerialsBySalId(client as any, salId) : [];

      await client.query('COMMIT');
      await invalidateCacheTags(isFbaSource ? ['fba-stage-counts'] : ['orders', 'orders-next', 'tech-logs']);
      if (salId && !isFbaSource) await publishTechLogChanged({ techId: testedBy, action: 'insert', rowId: salId, source: ROUTE });
      if (salId) publishActivityLogged({ id: salId, station: salStation, activityType: 'TRACKING_SCANNED', staffId: testedBy, scanRef: resolved.scanRef ?? value, fnsku: null, source: stationSource }).catch(() => {});
      if (!isFbaSource) {
        await publishOrderTested({ orderId: Number(order.id), testedBy, source: ROUTE });
      }

      const scanSessionId = await createStationScanSession(pool, {
        staffId: testedBy,
        sessionKind: 'ORDER',
        shipmentId: matchedShipmentId,
        trackingKey18: key18,
        trackingRaw: value,
        scanRef: resolved.scanRef ?? trackingValue,
      });

      const out = {
        success: true,
        found: true,
        orderFound: true,
        salId,
        techActivityId: salId,
        techSerialId: null,
        scanSessionId,
        order: buildOrderPayload(order, {
          tracking: trackingValue,
          serialNumbers: existingSerials,
          testDateTime,
          testedBy,
        }),
      };
      if (idemKey) await saveApiIdempotencyResponse(pool, { idempotencyKey: idemKey, route: ROUTE, staffId: testedBy, statusCode: 200, responseBody: out });
      return NextResponse.json(out);
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error in tech scan:', error);
    return NextResponse.json({ success: false, found: false, error: 'Scan failed', details: error.message }, { status: 500 });
  }
}
