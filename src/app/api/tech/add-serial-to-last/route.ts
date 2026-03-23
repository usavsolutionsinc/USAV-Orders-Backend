import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { insertTechSerialForTracking } from '@/lib/tech/insertTechSerialForTracking';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const serial = String(body?.serial || '').trim();
    const techId = String(body?.techId || '').trim();

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

    // Find the most recent TRACKING_SCANNED activity log for this tech
    const lastScanResult = await pool.query(
      `SELECT sal.id, sal.shipment_id, sal.scan_ref,
              COALESCE(stn.tracking_number_raw, sal.scan_ref) AS tracking
       FROM station_activity_logs sal
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
       WHERE sal.station = 'TECH'
         AND sal.activity_type = 'TRACKING_SCANNED'
         AND sal.staff_id = $1
       ORDER BY sal.created_at DESC, sal.id DESC
       LIMIT 1`,
      [techIdNum],
    );

    if (lastScanResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No previous tracking scan found — scan a tracking number first.' },
        { status: 404 },
      );
    }

    const lastScan = lastScanResult.rows[0];
    const tracking = String(lastScan.tracking || lastScan.scan_ref || '').trim();

    if (!tracking) {
      return NextResponse.json(
        { success: false, error: 'Last tracking scan has no resolvable tracking number.' },
        { status: 400 },
      );
    }

    const resolvedScan = {
      shipmentId: lastScan.shipment_id != null ? Number(lastScan.shipment_id) : null,
      scanRef: lastScan.scan_ref ?? null,
    };

    const result = await insertTechSerialForTracking(pool, {
      tracking,
      serial,
      techId,
      resolvedScan,
    });

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    // Load order info so the controller can restore the active order card
    let orderInfo = null;
    if (resolvedScan.shipmentId) {
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
        [resolvedScan.shipmentId, tracking],
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

    // Fallback when order is in exceptions / no match
    if (!orderInfo) {
      orderInfo = {
        id: null,
        orderId: 'N/A',
        productTitle: 'Unknown Product',
        itemNumber: null,
        sku: 'N/A',
        condition: 'N/A',
        notes: '',
        tracking,
        quantity: 1,
        shipByDate: null,
        createdAt: null,
        orderFound: false,
      };
    }

    return NextResponse.json({
      success: true,
      order: orderInfo,
      serialNumbers: result.serialNumbers,
      techSerialId: result.techSerialId,
    });
  } catch (error: any) {
    console.error('Error in add-serial-to-last:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to add serial', details: error.message },
      { status: 500 },
    );
  }
}
