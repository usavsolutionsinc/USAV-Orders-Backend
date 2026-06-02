import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';

/**
 * GET /api/testing/recent
 *
 * Recently-Tested feed, sourced from the `testing_results` log written by
 * /api/serial-units/[id]/test. One row per verdict click. Serial number, SKU,
 * and condition are JOINed from serial_units (single source of truth), not
 * stored on testing_results.
 *
 * Query params:
 *   limit   — rows to return (default 50, max 200)
 *   tester  — filter to a single staff id
 *   sku     — filter to a single SKU (exact, matched against serial_units.sku)
 *   verdict — PASS | TEST_AGAIN | TESTING_FAILED
 */
export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, Math.min(200, Number(searchParams.get('limit') || 50)));
  const tester = Number(searchParams.get('tester'));
  const sku = (searchParams.get('sku') || '').trim();
  const verdict = (searchParams.get('verdict') || '').trim().toUpperCase();

  const where: string[] = [];
  const params: unknown[] = [];
  if (Number.isFinite(tester) && tester > 0) {
    params.push(tester);
    where.push(`tr.tested_by = $${params.length}`);
  }
  if (sku) {
    params.push(sku);
    where.push(`su.sku = $${params.length}`);
  }
  if (['PASS', 'TEST_AGAIN', 'TESTING_FAILED'].includes(verdict)) {
    params.push(verdict);
    where.push(`tr.verdict = $${params.length}`);
  }
  params.push(limit);

  try {
    const result = await pool.query(
      `SELECT tr.id,
              tr.serial_unit_id,
              tr.receiving_line_id,
              su.serial_number,
              su.sku,
              su.condition_grade::text AS condition_grade,
              su.current_status::text  AS unit_current_status,
              tr.verdict,
              tr.unit_status,
              tr.tested_by,
              s.name AS tested_by_name,
              tr.notes,
              tr.created_at
         FROM testing_results tr
    LEFT JOIN serial_units su ON su.id = tr.serial_unit_id
    LEFT JOIN staff s         ON s.id  = tr.tested_by
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY tr.created_at DESC, tr.id DESC
        LIMIT $${params.length}`,
      params,
    );
    return NextResponse.json({ ok: true, results: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to load testing feed';
    console.error('[GET /api/testing/recent] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'tech.qc_pass' });
