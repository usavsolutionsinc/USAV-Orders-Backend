import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const staffIdParam = searchParams.get('staffId');
    const staffId = staffIdParam ? parseInt(staffIdParam, 10) : null;

    if (staffId && Number.isFinite(staffId)) {
      const single = await pool.query(
        `
          SELECT
            s.id AS staff_id,
            s.name,
            COALESCE(sg.daily_goal, 50) AS daily_goal
          FROM staff s
          LEFT JOIN staff_goals sg ON sg.staff_id = s.id
          WHERE s.id = $1
          LIMIT 1
        `,
        [staffId]
      );

      if (single.rows.length === 0) {
        return NextResponse.json({ error: 'Staff not found' }, { status: 404 });
      }

      return NextResponse.json(single.rows[0]);
    }

    const result = await pool.query(`
      WITH today_counts AS (
        SELECT
          tested_by AS staff_id,
          COUNT(*)::int AS today_count
        FROM tech_serial_numbers
        WHERE tested_by IS NOT NULL
          AND test_date_time IS NOT NULL
          AND DATE(test_date_time AT TIME ZONE 'America/Los_Angeles') =
              DATE(NOW() AT TIME ZONE 'America/Los_Angeles')
        GROUP BY tested_by
      ),
      week_counts AS (
        SELECT
          tested_by AS staff_id,
          COUNT(*)::int AS week_count
        FROM tech_serial_numbers
        WHERE tested_by IS NOT NULL
          AND test_date_time IS NOT NULL
          AND DATE(test_date_time AT TIME ZONE 'America/Los_Angeles') >=
              DATE(NOW() AT TIME ZONE 'America/Los_Angeles') - INTERVAL '6 day'
        GROUP BY tested_by
      )
      SELECT
        s.id AS staff_id,
        s.name,
        s.role,
        COALESCE(sg.daily_goal, 50) AS daily_goal,
        COALESCE(tc.today_count, 0) AS today_count,
        COALESCE(wc.week_count, 0) AS week_count,
        ROUND(COALESCE(wc.week_count, 0)::numeric / 7.0, 2) AS avg_daily_last_7d
      FROM staff s
      LEFT JOIN staff_goals sg ON sg.staff_id = s.id
      LEFT JOIN today_counts tc ON tc.staff_id = s.id
      LEFT JOIN week_counts wc ON wc.staff_id = s.id
      WHERE s.active = true
        AND s.role = 'technician'
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

    if (!Number.isFinite(staffId) || staffId <= 0) {
      return NextResponse.json({ error: 'Valid staffId is required' }, { status: 400 });
    }

    if (!Number.isFinite(dailyGoal) || dailyGoal <= 0) {
      return NextResponse.json({ error: 'dailyGoal must be greater than 0' }, { status: 400 });
    }

    await pool.query(
      `
        INSERT INTO staff_goals (staff_id, daily_goal, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (staff_id)
        DO UPDATE SET
          daily_goal = EXCLUDED.daily_goal,
          updated_at = NOW()
      `,
      [staffId, dailyGoal]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating staff goal:', error);
    return NextResponse.json({ error: 'Failed to update staff goal', details: error.message }, { status: 500 });
  }
}
