import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishTechLogChanged } from '@/lib/realtime/publish';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rowId = Number(body?.rowId);
    const sourceRowId = Number(body?.sourceRowId);
    const sourceKind = String(body?.sourceKind || '').trim();
    const techId = body?.techId ? Number(body.techId) : null;

    if (sourceKind === 'tech_scan') {
      if (!Number.isFinite(sourceRowId) || sourceRowId <= 0) {
        return NextResponse.json({ success: false, error: 'Valid sourceRowId is required for tech scan delete' }, { status: 400 });
      }
    } else if (!Number.isFinite(rowId) || rowId <= 0) {
      return NextResponse.json({ success: false, error: 'Valid rowId is required' }, { status: 400 });
    }
    const client = await pool.connect();

    let resolvedTechId: number | null = techId ?? null;
    let deletedCount = 0;

    try {
      await client.query('BEGIN');

      if (sourceKind === 'tech_scan') {
        const fetchSal = await client.query(
          `SELECT staff_id
           FROM station_activity_logs
           WHERE id = $1
             AND station = 'TECH'
             AND activity_type = 'TRACKING_SCANNED'
           LIMIT 1`,
          [sourceRowId]
        );
        resolvedTechId = fetchSal.rows[0]?.staff_id ?? resolvedTechId ?? null;

        const deleteSal = await client.query(
          `DELETE FROM station_activity_logs
           WHERE id = $1
             AND station = 'TECH'
             AND activity_type = 'TRACKING_SCANNED'`,
          [sourceRowId]
        );
        deletedCount = Number(deleteSal.rowCount || 0);
      } else {
        const fetchResult = await client.query(
          `SELECT id, tested_by, shipment_id, scan_ref, fnsku
           FROM tech_serial_numbers
           WHERE id = $1
           LIMIT 1`,
          [rowId]
        );
        const tsnRow = fetchResult.rows[0] ?? null;
        if (!tsnRow) {
          await client.query('ROLLBACK');
          return NextResponse.json({ success: false, error: 'Tech serial row not found' }, { status: 404 });
        }

        resolvedTechId = tsnRow.tested_by ?? resolvedTechId ?? null;

        const deleteSerialSal = await client.query(
          `DELETE FROM station_activity_logs
           WHERE station = 'TECH'
             AND activity_type = 'SERIAL_ADDED'
             AND tech_serial_number_id = $1`,
          [rowId]
        );

        const deleteTrackingSal = await client.query(
          `DELETE FROM station_activity_logs
           WHERE station = 'TECH'
             AND activity_type = 'TRACKING_SCANNED'
             AND staff_id IS NOT DISTINCT FROM $1
             AND (
               ($2::bigint IS NOT NULL AND shipment_id = $2)
               OR (
                 COALESCE($3, '') <> ''
                 AND RIGHT(regexp_replace(UPPER(COALESCE(scan_ref, metadata->>'tracking', '')), '[^A-Z0-9]', '', 'g'), 18) =
                     RIGHT(regexp_replace(UPPER($3), '[^A-Z0-9]', '', 'g'), 18)
               )
               OR (
                 COALESCE($4, '') <> ''
                 AND UPPER(TRIM(COALESCE(fnsku, ''))) = UPPER(TRIM($4))
               )
             )`,
          [resolvedTechId, tsnRow.shipment_id ?? null, tsnRow.scan_ref ?? null, tsnRow.fnsku ?? null]
        );

        const deleteTsn = await client.query(
          `DELETE FROM tech_serial_numbers
           WHERE id = $1`,
          [rowId]
        );

        deletedCount =
          Number(deleteSerialSal.rowCount || 0) +
          Number(deleteTrackingSal.rowCount || 0) +
          Number(deleteTsn.rowCount || 0);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    await invalidateCacheTags(['tech-logs', 'orders-next', 'shipped', 'orders']);

    if (resolvedTechId) {
      await publishTechLogChanged({
        techId: resolvedTechId,
        action: 'delete',
        rowId,
        source: 'tech.delete-tracking',
      });
    }

    return NextResponse.json({
      success: true,
      deletedCount,
    });
  } catch (error: any) {
    console.error('Delete tech tracking error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete tech tracking records' },
      { status: 500 }
    );
  }
}
