import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { POST as unifiedDelete } from '@/app/api/tech/delete/route';

/**
 * Legacy POST /api/tech/delete-tracking — thin wrapper around POST /api/tech/delete.
 * Resolves SAL id from { sourceRowId, sourceKind } or { rowId }, then delegates.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });

  const sourceRowId = body.sourceRowId ? Number(body.sourceRowId) : null;
  const sourceKind = String(body.sourceKind || '').trim();
  const rowId = body.rowId ? Number(body.rowId) : null;

  let salId: number | null = null;

  // If sourceKind is a SAL-based row (fba_scan or tech_scan), the sourceRowId IS the SAL id
  if (sourceRowId && (sourceKind === 'fba_scan' || sourceKind === 'tech_scan')) {
    salId = sourceRowId;
  }

  // If sourceKind is tech_serial, find the SAL via context_station_activity_log_id
  if (!salId && sourceRowId && sourceKind === 'tech_serial') {
    const r = await pool.query(
      `SELECT context_station_activity_log_id FROM tech_serial_numbers WHERE id = $1 LIMIT 1`,
      [sourceRowId],
    );
    salId = r.rows[0]?.context_station_activity_log_id ?? null;
  }

  // Fallback: try rowId as a TSN id
  if (!salId && rowId) {
    const r = await pool.query(
      `SELECT context_station_activity_log_id FROM tech_serial_numbers WHERE id = $1 LIMIT 1`,
      [rowId],
    );
    salId = r.rows[0]?.context_station_activity_log_id ?? null;
  }

  // Final fallback: try rowId as a SAL id directly
  if (!salId && rowId) {
    const r = await pool.query(
      `SELECT id FROM station_activity_logs WHERE id = $1 AND station = 'TECH' LIMIT 1`,
      [rowId],
    );
    salId = r.rows[0]?.id ?? null;
  }

  if (!salId) {
    return NextResponse.json({ success: false, error: 'Could not resolve scan session for deletion' }, { status: 404 });
  }

  const syntheticReq = new NextRequest(req.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ salId }),
  });

  return unifiedDelete(syntheticReq);
}
