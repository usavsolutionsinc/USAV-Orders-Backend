import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawDays = Number(searchParams.get('days') || 14);
    const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(90, Math.floor(rawDays))) : 14;
    const rawStation = String(searchParams.get('station') || 'ALL').trim().toUpperCase();
    const station = rawStation === 'ALL' ? null : rawStation;

    const params: Array<string | number> = [days];
    let stationFilter = '';

    if (station) {
      params.push(station);
      stationFilter = `AND h.station = $2`;
    }

    const result = await pool.query(
      `
        SELECT
          h.staff_id,
          s.name,
          s.role,
          h.station,
          h.goal,
          h.actual,
          h.logged_date::text AS logged_date
        FROM staff_goal_history h
        JOIN staff s ON s.id = h.staff_id
        WHERE h.logged_date >= (
          (timezone('America/Los_Angeles', now()))::date - ($1::int - 1)
        )
        ${stationFilter}
        ORDER BY h.logged_date DESC, s.name ASC, h.station ASC
      `,
      params,
    );

    return NextResponse.json(result.rows);
  } catch (error: any) {
    console.error('Error fetching staff goal history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch staff goal history', details: error?.message || String(error) },
      { status: 500 },
    );
  }
}
