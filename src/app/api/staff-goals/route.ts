import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { upsertStaffGoal } from '@/lib/neon/staff-goals-queries';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const staffIdParam = searchParams.get('staffId');
    const stationParam = searchParams.get('station');
    const staffId = staffIdParam ? parseInt(staffIdParam, 10) : null;

    // Single staff lookup
    if (staffId && Number.isFinite(staffId)) {
      const single = await pool.query(
        `SELECT s.id AS staff_id, s.name, s.employee_id,
                COALESCE(sg.daily_goal, 50) AS daily_goal,
                COALESCE(sg.station, 'TECH') AS station
         FROM staff s
         LEFT JOIN staff_goals sg ON sg.staff_id = s.id
           ${stationParam ? 'AND sg.station = $2' : ''}
         WHERE s.id = $1 LIMIT 1`,
        stationParam ? [staffId, stationParam] : [staffId],
      );
      if (single.rows.length === 0) {
        return NextResponse.json({ error: 'Staff not found' }, { status: 404 });
      }
      return NextResponse.json(single.rows[0]);
    }

    // All staff with live SAL-based counts
    // Derive default station from employee_id prefix when no goal row exists
    const stationFilter = stationParam ? `AND sg.station = '${stationParam.replace(/'/g, '')}'` : '';

    const result = await pool.query(`
      WITH derived_station AS (
        SELECT id,
          CASE
            WHEN UPPER(employee_id) LIKE 'PACK%' THEN 'PACK'
            WHEN UPPER(employee_id) LIKE 'UNBOX%' THEN 'UNBOX'
            WHEN UPPER(employee_id) LIKE 'SALES%' THEN 'SALES'
            ELSE 'TECH'
          END AS default_station
        FROM staff
      ),
      today_counts AS (
        SELECT staff_id, station, COUNT(*)::int AS today_count
        FROM station_activity_logs
        WHERE staff_id IS NOT NULL
          AND (timezone('America/Los_Angeles', created_at))::date
            = (timezone('America/Los_Angeles', now()))::date
        GROUP BY staff_id, station
      ),
      week_counts AS (
        SELECT staff_id, station, COUNT(*)::int AS week_count
        FROM station_activity_logs
        WHERE staff_id IS NOT NULL
          AND (timezone('America/Los_Angeles', created_at))::date
            >= (timezone('America/Los_Angeles', now()))::date - INTERVAL '6 days'
        GROUP BY staff_id, station
      )
      SELECT
        s.id AS staff_id,
        s.name,
        s.role,
        s.employee_id,
        COALESCE(sg.station, ds.default_station) AS station,
        COALESCE(sg.daily_goal, 50) AS daily_goal,
        COALESCE(tc.today_count, 0) AS today_count,
        COALESCE(wc.week_count, 0) AS week_count,
        ROUND(COALESCE(wc.week_count, 0)::numeric / 7.0, 2) AS avg_daily_last_7d
      FROM staff s
      JOIN derived_station ds ON ds.id = s.id
      LEFT JOIN staff_goals sg ON sg.staff_id = s.id ${stationFilter}
      LEFT JOIN today_counts tc ON tc.staff_id = s.id AND tc.station = COALESCE(sg.station, ds.default_station)
      LEFT JOIN week_counts wc ON wc.staff_id = s.id AND wc.station = COALESCE(sg.station, ds.default_station)
      WHERE s.active = true
      ORDER BY s.name ASC
    `);

    return NextResponse.json(result.rows);
  } catch (error: any) {
    console.error('Error fetching staff goals:', error);
    return NextResponse.json({ error: 'Failed to fetch staff goals', details: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const staffId = parseInt(String(body?.staffId || ''), 10);
    const dailyGoal = parseInt(String(body?.dailyGoal || ''), 10);
    const station = String(body?.station || 'TECH').toUpperCase();

    if (!Number.isFinite(staffId) || staffId <= 0) {
      return NextResponse.json({ error: 'Valid staffId is required' }, { status: 400 });
    }
    if (!Number.isFinite(dailyGoal) || dailyGoal <= 0) {
      return NextResponse.json({ error: 'dailyGoal must be greater than 0' }, { status: 400 });
    }
    if (!['TECH', 'PACK', 'UNBOX', 'SALES'].includes(station)) {
      return NextResponse.json({ error: 'station must be TECH, PACK, UNBOX, or SALES' }, { status: 400 });
    }

    await upsertStaffGoal(staffId, dailyGoal, station);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating staff goal:', error);
    return NextResponse.json({ error: 'Failed to update staff goal', details: error.message }, { status: 500 });
  }
}
