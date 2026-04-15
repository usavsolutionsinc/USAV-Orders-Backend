import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get('sku') || null;
    const poId = searchParams.get('poId') || null;
    const limit = Math.min(Number(searchParams.get('limit') || '200'), 500);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 0;

    // Only show receiving lines linked to replenishment POs by default
    if (poId) {
      idx += 1;
      conditions.push(`rl.zoho_purchaseorder_id = $${idx}`);
      params.push(poId);
    } else {
      conditions.push(
        `rl.zoho_purchaseorder_id IN (
          SELECT zoho_po_id FROM replenishment_requests
          WHERE zoho_po_id IS NOT NULL
            AND status NOT IN ('fulfilled', 'cancelled')
        )`
      );
    }

    if (sku) {
      idx += 1;
      conditions.push(`(rl.sku ILIKE '%' || $${idx} || '%' OR rl.item_name ILIKE '%' || $${idx} || '%')`);
      params.push(sku);
    }

    idx += 1;
    params.push(limit);

    const sql = `
      SELECT
        rl.id,
        rl.receiving_id,
        rl.zoho_item_id,
        rl.item_name,
        rl.sku,
        rl.quantity_expected,
        rl.quantity_received,
        rl.workflow_status,
        rl.qa_status,
        rl.zoho_purchaseorder_id,
        rl.created_at,
        rl.updated_at,
        COALESCE(stn.tracking_number_raw, r.receiving_tracking_number) AS receiving_tracking_number,
        COALESCE(NULLIF(stn.carrier, 'UNKNOWN'), r.carrier)             AS carrier,
        r.received_at,
        rr.id AS replenishment_request_id,
        rr.zoho_po_number,
        rr.status AS replenishment_status,
        rr.item_name AS replenishment_item_name
      FROM receiving_lines rl
      LEFT JOIN receiving r                   ON r.id  = rl.receiving_id
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
      LEFT JOIN replenishment_requests rr     ON rr.zoho_po_id = rl.zoho_purchaseorder_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY rl.created_at DESC
      LIMIT $${idx}
    `;

    const result = await pool.query(sql, params);

    return NextResponse.json({
      lines: result.rows,
      count: result.rows.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to fetch receiving lines', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
