import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getAllStaffGoalsWithStats } from '@/lib/neon/staff-goals-queries';
import { SHIPPED_BY_CARRIER_SQL } from '@/lib/sql-fragments';

export async function GET(req: NextRequest) {
  try {
    const todayFilter = `(timezone('America/Los_Angeles', created_at))::date = (timezone('America/Los_Angeles', now()))::date`;
    const yesterdayFilter = `(timezone('America/Los_Angeles', created_at))::date = (timezone('America/Los_Angeles', now()))::date - 1`;

    // ── Summary KPIs (today + yesterday for deltas) ──────────────────────
    const summaryQuery = `
      WITH pending_orders AS (
        SELECT o.id, o.out_of_stock
        FROM orders o
        LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
        WHERE o.shipment_id IS NOT NULL
          AND NOT ${SHIPPED_BY_CARRIER_SQL}
          AND NOT EXISTS (
            SELECT 1 FROM station_activity_logs sal
            WHERE sal.shipment_id IS NOT NULL AND sal.shipment_id = o.shipment_id
          )
          AND UPPER(COALESCE(o.status, '')) <> 'SHIPPED'
      ),
      late_orders AS (
        SELECT po.id
        FROM pending_orders po
        JOIN work_assignments wa ON wa.entity_type = 'ORDER'
          AND wa.entity_id = po.id
          AND wa.work_type = 'TEST'
          AND wa.status IN ('ASSIGNED', 'IN_PROGRESS', 'OPEN')
        WHERE wa.deadline_at IS NOT NULL AND wa.deadline_at < now()
      )
      SELECT
        (SELECT count(DISTINCT COALESCE(shipment_id::text, scan_ref, id::text))::int FROM station_activity_logs
         WHERE activity_type IN ('TRACKING_SCANNED', 'FNSKU_SCANNED', 'PACK_SCAN', 'PACK_COMPLETED', 'FBA_READY')
           AND ${todayFilter}) AS all_today,
        (SELECT count(DISTINCT COALESCE(shipment_id::text, scan_ref, id::text))::int FROM station_activity_logs
         WHERE activity_type IN ('TRACKING_SCANNED', 'FNSKU_SCANNED', 'PACK_SCAN', 'PACK_COMPLETED', 'FBA_READY')
           AND ${yesterdayFilter}) AS all_yesterday,
        (SELECT count(DISTINCT COALESCE(shipment_id::text, scan_ref, id::text))::int FROM station_activity_logs
         WHERE station = 'TECH'
           AND activity_type IN ('TRACKING_SCANNED', 'FNSKU_SCANNED')
           AND ${todayFilter}) AS tested_today,
        (SELECT count(DISTINCT COALESCE(shipment_id::text, scan_ref, id::text))::int FROM station_activity_logs
         WHERE station = 'TECH'
           AND activity_type IN ('TRACKING_SCANNED', 'FNSKU_SCANNED')
           AND ${yesterdayFilter}) AS tested_yesterday,
        (SELECT count(*)::int FROM repair_service WHERE status NOT IN ('Done', 'Shipped', 'Picked Up')) AS repair_count,
        (SELECT count(*)::int FROM pending_orders WHERE COALESCE(BTRIM(out_of_stock), '') <> '') AS oos_count,
        (SELECT count(*)::int FROM late_orders) AS late_count,
        (SELECT count(*)::int FROM station_activity_logs WHERE activity_type = 'FNSKU_SCANNED' AND ${todayFilter}) AS fba_today,
        (SELECT count(*)::int FROM station_activity_logs WHERE activity_type = 'FNSKU_SCANNED' AND ${yesterdayFilter}) AS fba_yesterday
    `;
    const summaryResult = await pool.query(summaryQuery);
    const s = summaryResult.rows[0];

    const computeDelta = (today: number, yesterday: number) =>
      yesterday > 0 ? Math.round(((today - yesterday) / yesterday) * 100) : 0;

    // ── Staff Progress ───────────────────────────────────────────────────
    const staffStats = await getAllStaffGoalsWithStats();
    const staffProgress = staffStats.map((st) => {
      const progress = st.today_count;
      const goal = st.daily_goal;
      const percent = goal > 0 ? Math.round((progress / goal) * 100) : 0;
      let status: 'on_track' | 'at_risk' | 'behind' = 'behind';
      if (percent >= 85) status = 'on_track';
      else if (percent >= 60) status = 'at_risk';

      return {
        staffId: st.staff_id,
        name: st.staff_name,
        goal: st.daily_goal,
        current: st.today_count,
        percent,
        status,
        daysLate: 0,
        station: st.station,
      };
    });

    // ── Activity Feed ────────────────────────────────────────────────────
    const feedQuery = `
      SELECT
        sal.id::text,
        sal.created_at as timestamp,
        sal.activity_type as type,
        sal.station as source,
        COALESCE(sal.scan_ref, sal.notes, 'Activity logged') as summary,
        sal.staff_id,
        s.name as actor_name
      FROM station_activity_logs sal
      JOIN staff s ON s.id = sal.staff_id
      ORDER BY sal.created_at DESC
      LIMIT 20
    `;
    const feedResult = await pool.query(feedQuery);

    return NextResponse.json({
      summary: {
        all: { value: s.all_today, delta: computeDelta(s.all_today, s.all_yesterday) },
        tested: { value: s.tested_today, delta: computeDelta(s.tested_today, s.tested_yesterday) },
        repair: { value: s.repair_count, delta: 0 },
        outOfStock: { value: s.oos_count, delta: 0 },
        pendingLate: { value: s.late_count, delta: 0 },
        fba: { value: s.fba_today, delta: computeDelta(s.fba_today, s.fba_yesterday) },
      },
      staffProgress,
      activityFeed: feedResult.rows,
    });
  } catch (error: any) {
    console.error('Operations Dashboard API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
