import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limitRaw = Number(searchParams.get('limit') || 50);
    const limit = Math.min(Math.max(limitRaw, 1), 100);
    const since = searchParams.get('since') || null;

    const params: any[] = [limit];
    let sinceClauseSAL = '';
    let sinceClauseLedger = '';
    if (since) {
      sinceClauseSAL = 'AND sal.created_at > $2';
      sinceClauseLedger = 'AND l.created_at > $2';
      params.push(since);
    }

    // Unified feed: station activity + stock-ledger deltas. Ledger rows are
    // synthesized into the same shape; their id is negated to avoid collision
    // with real station_activity_logs ids. Client treats them as first-class
    // events and renders with reason-aware labels.
    const result = await pool.query(
      `WITH sal_events AS (
         SELECT
           sal.id                            AS id,
           sal.station                       AS station,
           sal.activity_type                 AS activity_type,
           sal.staff_id                      AS staff_id,
           s.name                            AS staff_name,
           sal.scan_ref                      AS scan_ref,
           sal.fnsku                         AS fnsku,
           sal.shipment_id                   AS shipment_id,
           sal.notes                         AS notes,
           sal.created_at                    AS created_at,
           NULL::int                         AS delta,
           NULL::text                        AS dimension,
           NULL::text                        AS reason
         FROM station_activity_logs sal
         LEFT JOIN staff s ON s.id = sal.staff_id
         WHERE 1=1 ${sinceClauseSAL}
       ),
       ledger_events AS (
         SELECT
           -l.id                             AS id,
           CASE l.reason
             WHEN 'PICKED'         THEN 'TECH'
             WHEN 'PACKED'         THEN 'PACK'
             WHEN 'SHIPPED'        THEN 'PACK'
             WHEN 'RECEIVED'       THEN 'RECEIVING'
             WHEN 'RETURNED'       THEN 'RECEIVING'
             ELSE 'ADMIN'
           END                               AS station,
           CONCAT('STOCK_DELTA_', l.reason)  AS activity_type,
           l.staff_id                        AS staff_id,
           s.name                            AS staff_name,
           l.sku                             AS scan_ref,
           NULL::text                        AS fnsku,
           l.ref_shipment_id                 AS shipment_id,
           l.notes                           AS notes,
           l.created_at                      AS created_at,
           l.delta                           AS delta,
           l.dimension                       AS dimension,
           l.reason                          AS reason
         FROM sku_stock_ledger l
         LEFT JOIN staff s ON s.id = l.staff_id
         WHERE l.reason <> 'INITIAL_BALANCE' ${sinceClauseLedger}
       )
       SELECT * FROM (
         SELECT * FROM sal_events
         UNION ALL
         SELECT * FROM ledger_events
       ) u
       ORDER BY created_at DESC
       LIMIT $1`,
      params
    );

    return NextResponse.json({
      success: true,
      activities: result.rows.map((row: any) => ({
        id: Number(row.id),
        station: row.station,
        activity_type: row.activity_type,
        staff_id: row.staff_id ? Number(row.staff_id) : null,
        staff_name: row.staff_name || null,
        scan_ref: row.scan_ref || null,
        fnsku: row.fnsku || null,
        shipment_id: row.shipment_id ? Number(row.shipment_id) : null,
        notes: row.notes || null,
        created_at: row.created_at,
        delta: row.delta != null ? Number(row.delta) : null,
        dimension: row.dimension || null,
        reason: row.reason || null,
      })),
    });
  } catch (error: any) {
    console.error('[activity/feed] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch activity feed' },
      { status: 500 }
    );
  }
}
