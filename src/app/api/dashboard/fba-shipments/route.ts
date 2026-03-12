import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// ── GET /api/dashboard/fba-shipments ─────────────────────────────────────────
// Returns FBA shipments from fba_shipments (new lifecycle tables) with
// aggregated item readiness counts and staff names for the dashboard board.
// Falls back gracefully if the tables don't exist yet (pre-migration).
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = String(searchParams.get('q') || '').trim();
    const limitRaw = Number(searchParams.get('limit') || 200);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 1000) : 200;

    // Check if the new lifecycle tables exist yet
    const tableExists = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables WHERE table_name = 'fba_shipments'
       ) AS exists`
    );

    if (!tableExists.rows[0]?.exists) {
      // Pre-migration fallback: old receiving-based query
      const receivingExists = await pool.query(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables WHERE table_name = 'receiving'
         ) AS exists`
      );
      if (!receivingExists.rows[0]?.exists) {
        return NextResponse.json({ success: true, rows: [], source: 'none' });
      }

      const receivingColumns = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name = 'receiving'`
      );
      const hasReceivedAt = receivingColumns.rows.some((row) => row.column_name === 'received_at');
      const receivedAtSelect = hasReceivedAt ? 'r.received_at::text' : 'NULL::text';

      const legacy = await pool.query(
        `SELECT
           r.id,
           r.receiving_tracking_number AS shipment_ref,
           r.carrier,
           r.qa_status,
           r.disposition_code,
           r.condition_grade,
           r.target_channel,
           r.needs_test,
           r.assigned_tech_id,
           s.name AS assigned_tech_name,
           ${receivedAtSelect} AS received_at,
           'LEGACY' AS source
         FROM receiving r
         LEFT JOIN staff s ON s.id = r.assigned_tech_id
         WHERE r.receiving_tracking_number IS NOT NULL
           AND r.receiving_tracking_number != ''
           AND UPPER(COALESCE(r.target_channel::text, '')) = 'FBA'
           AND ($1 = '' OR r.receiving_tracking_number ILIKE '%' || $1 || '%' OR COALESCE(s.name,'') ILIKE '%' || $1 || '%')
         ORDER BY r.id DESC
         LIMIT $2`,
        [q, limit]
      );
      return NextResponse.json({ success: true, rows: legacy.rows, source: 'legacy' });
    }

    // New lifecycle query
    const params: unknown[] = [];
    let idx = 1;
    const conditions: string[] = [];

    if (q) {
      conditions.push(`(fs.shipment_ref ILIKE $${idx} OR fs.notes ILIKE $${idx} OR tech.name ILIKE $${idx} OR packer.name ILIKE $${idx})`);
      params.push(`%${q}%`);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);

    const result = await pool.query(
      `SELECT
         fs.id,
         fs.shipment_ref,
         fs.destination_fc,
         fs.due_date,
         fs.status,
         fs.notes,
         fs.shipped_at,
         fs.created_at,
         fs.updated_at,
         fs.created_by_staff_id,
         fs.assigned_tech_id,
         fs.assigned_packer_id,
         creator.name  AS created_by_name,
         tech.name     AS assigned_tech_name,
         packer.name   AS assigned_packer_name,
         COUNT(fsi.id)                                               AS total_items,
         COUNT(fsi.id) FILTER (WHERE fsi.status = 'READY_TO_GO')    AS ready_items,
         COUNT(fsi.id) FILTER (WHERE fsi.status = 'LABEL_ASSIGNED') AS labeled_items,
         COUNT(fsi.id) FILTER (WHERE fsi.status = 'SHIPPED')        AS shipped_items,
         COALESCE(SUM(fsi.expected_qty), 0)                          AS total_expected_qty,
         COALESCE(SUM(fsi.actual_qty), 0)                            AS total_actual_qty,
         'lifecycle' AS source
       FROM fba_shipments fs
       LEFT JOIN staff creator ON creator.id = fs.created_by_staff_id
       LEFT JOIN staff tech    ON tech.id    = fs.assigned_tech_id
       LEFT JOIN staff packer  ON packer.id  = fs.assigned_packer_id
       LEFT JOIN fba_shipment_items fsi ON fsi.shipment_id = fs.id
       ${whereClause}
       GROUP BY fs.id, creator.name, tech.name, packer.name
       ORDER BY fs.created_at DESC
       LIMIT $${idx}`,
      params
    );

    return NextResponse.json({ success: true, rows: result.rows, source: 'lifecycle' });
  } catch (error: any) {
    console.error('[GET /api/dashboard/fba-shipments]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch FBA shipments' },
      { status: 500 }
    );
  }
}
