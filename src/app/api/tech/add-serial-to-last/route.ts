import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getApiIdempotencyResponse, readIdempotencyKey, saveApiIdempotencyResponse } from '@/lib/api-idempotency';
import { getValidStationScanSession } from '@/lib/station-scan-session';
import { insertTechSerialForTracking } from '@/lib/tech/insertTechSerialForTracking';
import { resolveStaffIdFromTechParam } from '@/lib/tech/resolveStaffIdFromTechParam';

const ROUTE = 'tech.add-serial-to-last';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const idemKey = readIdempotencyKey(req, body?.idempotencyKey);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, idemKey, ROUTE);
      if (hit && hit.status_code === 200) {
        return NextResponse.json(hit.response_body, { status: 200 });
      }
    }

    const serial = String(body?.serial || '').trim();
    const techId = String(body?.techId || '').trim();
    const scanSessionId = body?.scanSessionId != null ? String(body.scanSessionId).trim() : '';

    if (!serial || !techId) {
      return NextResponse.json(
        { success: false, error: 'serial and techId are required' },
        { status: 400 },
      );
    }

    const techIdNum = parseInt(techId, 10);
    if (!Number.isFinite(techIdNum) || techIdNum <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid techId' },
        { status: 400 },
      );
    }

    const staffId = await resolveStaffIdFromTechParam(pool, techId);
    if (!staffId) {
      return NextResponse.json({ success: false, error: 'Staff not found' }, { status: 404 });
    }

    if (scanSessionId) {
      const sess = await getValidStationScanSession(pool, scanSessionId, staffId);
      if (!sess) {
        return NextResponse.json(
          { success: false, error: 'Invalid or expired scan session — scan tracking again.' },
          { status: 400 },
        );
      }
      if (sess.session_kind === 'REPAIR') {
        return NextResponse.json(
          { success: false, error: 'Repair session cannot accept serial scans here.' },
          { status: 400 },
        );
      }
    }

    const result = await insertTechSerialForTracking(pool, {
      serial,
      techId,
    });

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    let tracking = '';
    const shipQ = await pool.query(
      `SELECT COALESCE(stn.tracking_number_raw, tsn.fnsku, '') AS trk
       FROM tech_serial_numbers tsn
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = tsn.shipment_id
       WHERE tsn.id = $1`,
      [result.techSerialId],
    );
    tracking = String(shipQ.rows[0]?.trk || '').trim();

    let orderInfo = null;
    const resolvedShipmentQ = await pool.query(
      `SELECT shipment_id FROM tech_serial_numbers WHERE id = $1`,
      [result.techSerialId],
    );
    const resolvedShipmentId = resolvedShipmentQ.rows[0]?.shipment_id;

    if (resolvedShipmentId) {
      const orderResult = await pool.query(
        `SELECT o.id, o.order_id, o.product_title, o.item_number, o.sku,
                o.condition, o.notes, o.quantity, o.account_source,
                COALESCE(stn.tracking_number_raw, $2) AS shipping_tracking_number,
                to_char(wa.deadline_at, 'YYYY-MM-DD') AS ship_by_date,
                o.created_at
         FROM orders o
         LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
         LEFT JOIN LATERAL (
           SELECT wa2.deadline_at FROM work_assignments wa2
           WHERE wa2.entity_type = 'ORDER' AND wa2.entity_id = o.id AND wa2.work_type = 'TEST'
           ORDER BY CASE wa2.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2
                                    WHEN 'OPEN' THEN 3 WHEN 'DONE' THEN 4 ELSE 5 END,
                    wa2.updated_at DESC, wa2.id DESC LIMIT 1
         ) wa ON TRUE
         WHERE o.shipment_id = $1
         ORDER BY o.id DESC LIMIT 1`,
        [resolvedShipmentId, tracking],
      );
      if (orderResult.rows[0]) {
        const row = orderResult.rows[0];
        orderInfo = {
          id: row.id,
          orderId: row.order_id || 'N/A',
          productTitle: row.product_title || 'Unknown Product',
          itemNumber: row.item_number || null,
          sku: row.sku || 'N/A',
          condition: row.condition || 'N/A',
          notes: row.notes || '',
          tracking: row.shipping_tracking_number || tracking,
          quantity: parseInt(String(row.quantity || '1'), 10) || 1,
          shipByDate: row.ship_by_date || null,
          createdAt: row.created_at || null,
          orderFound: true,
        };
      }
    }

    if (!orderInfo) {
      orderInfo = {
        id: null,
        orderId: 'N/A',
        productTitle: 'Unknown Product',
        itemNumber: null,
        sku: 'N/A',
        condition: 'N/A',
        notes: '',
        tracking: tracking || 'N/A',
        quantity: 1,
        shipByDate: null,
        createdAt: null,
        orderFound: false,
      };
    }

    const out = {
      success: true,
      order: orderInfo,
      serialNumbers: result.serialNumbers,
      techSerialId: result.techSerialId,
      scanSessionId: scanSessionId || null,
    };

    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        idempotencyKey: idemKey,
        route: ROUTE,
        staffId,
        statusCode: 200,
        responseBody: out,
      });
    }

    return NextResponse.json(out);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in add-serial-to-last:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to add serial', details: message },
      { status: 500 },
    );
  }
}
