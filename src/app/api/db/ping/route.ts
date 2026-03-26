import { NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/db/ping
 *
 * Lightweight DB health-check. Issues a trivial query and returns:
 *   { ok: true, db_time, latency_ms }  on success (200)
 *   { ok: false, error, latency_ms }   on failure (503)
 *
 * Useful for smoke-testing the DATABASE_URL from localhost:3000.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    const result = await pool.query<{ ok: number; db_time: string }>(
      `SELECT 1 AS ok, NOW() AT TIME ZONE 'America/Los_Angeles' AS db_time`,
    );
    return NextResponse.json(
      {
        ok: true,
        db_time: result.rows[0]?.db_time ?? null,
        latency_ms: Date.now() - startedAt,
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error('[/api/db/ping] DB connection failed:', error.message);
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
        latency_ms: Date.now() - startedAt,
      },
      { status: 503 },
    );
  }
}
