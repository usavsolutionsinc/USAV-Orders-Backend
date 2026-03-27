import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishTechLogChanged } from '@/lib/realtime/publish';

/**
 * Simplified delete: SAL is SoT, cascade to TSN + fba_fnsku_logs.
 * Body: { salId: number }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });

  const salId = Number(body.salId);
  if (!Number.isFinite(salId) || salId <= 0) {
    return NextResponse.json({ success: false, error: 'salId is required' }, { status: 400 });
  }

  try {
    // Verify SAL row exists and get staff for cache invalidation
    const salRow = await pool.query(
      `SELECT id, staff_id, fnsku FROM station_activity_logs WHERE id = $1`,
      [salId],
    );
    if (salRow.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Scan session not found' }, { status: 404 });
    }
    const staffId = salRow.rows[0].staff_id;

    let deletedSerialCount = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Delete SERIAL_ADDED SAL rows that reference TSN rows for this session
      await client.query(
        `DELETE FROM station_activity_logs
         WHERE activity_type = 'SERIAL_ADDED'
           AND tech_serial_number_id IN (
             SELECT id FROM tech_serial_numbers WHERE context_station_activity_log_id = $1
           )`,
        [salId],
      );

      // 2. Delete TSN rows linked to this SAL
      const deletedTsn = await client.query(
        `DELETE FROM tech_serial_numbers WHERE context_station_activity_log_id = $1`,
        [salId],
      );
      deletedSerialCount = deletedTsn.rowCount ?? 0;

      // 3. Delete fba_fnsku_logs linked to this SAL
      await client.query(
        `DELETE FROM fba_fnsku_logs WHERE station_activity_log_id = $1`,
        [salId],
      );

      // 4. Delete the anchor SAL row itself
      await client.query(
        `DELETE FROM station_activity_logs WHERE id = $1`,
        [salId],
      );

      await client.query('COMMIT');
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

    await invalidateCacheTags(['tech-logs', 'orders-next', 'shipped', 'orders']);
    if (staffId) {
      await publishTechLogChanged({ techId: staffId, action: 'delete', source: 'tech.delete' });
    }

    return NextResponse.json({ success: true, deletedSerials: deletedSerialCount });
  } catch (error: any) {
    console.error('Error in tech delete:', error);
    return NextResponse.json({ success: false, error: 'Delete failed', details: error.message }, { status: 500 });
  }
}
