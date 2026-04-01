import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';

type SerialRow = {
  id: number;
  serial_number: string;
  serial_type: string;
  tested_by: number | null;
  station_source: string;
  receiving_line_id: number | null;
  created_at: string | null;
  updated_at: string | null;
};

function normalizeSerial(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function normalizeRow(row: SerialRow) {
  return {
    id: Number(row.id),
    serial_number: row.serial_number,
    serial_type: row.serial_type,
    tested_by: row.tested_by != null ? Number(row.tested_by) : null,
    station_source: row.station_source,
    receiving_line_id: row.receiving_line_id != null ? Number(row.receiving_line_id) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const receivingLineId = Number(searchParams.get('receiving_line_id'));

    if (!Number.isFinite(receivingLineId) || receivingLineId <= 0) {
      return NextResponse.json(
        { success: false, error: 'receiving_line_id is required' },
        { status: 400 },
      );
    }

    const result = await pool.query<SerialRow>(
      `SELECT id, serial_number, serial_type, tested_by, station_source, receiving_line_id,
              created_at::text, updated_at::text
       FROM tech_serial_numbers
       WHERE station_source = 'RECEIVING'
         AND receiving_line_id = $1
       ORDER BY created_at ASC, id ASC`,
      [receivingLineId],
    );

    return NextResponse.json({
      success: true,
      serials: result.rows.map(normalizeRow),
      count: result.rowCount ?? 0,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch receiving serials';
    console.error('receiving/serials GET failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const receivingLineId = Number(body?.receiving_line_id);
    const serialNumber = normalizeSerial(body?.serial_number ?? body?.serial);
    const serialType = String(body?.serial_type || 'SERIAL').trim().toUpperCase() || 'SERIAL';
    const testedByRaw = Number(body?.tested_by ?? body?.staff_id);
    const testedBy = Number.isFinite(testedByRaw) && testedByRaw > 0 ? testedByRaw : null;

    if (!Number.isFinite(receivingLineId) || receivingLineId <= 0) {
      return NextResponse.json(
        { success: false, error: 'receiving_line_id is required' },
        { status: 400 },
      );
    }
    if (!serialNumber) {
      return NextResponse.json(
        { success: false, error: 'serial_number is required' },
        { status: 400 },
      );
    }

    const lineRes = await pool.query<{ id: number; receiving_id: number | null }>(
      `SELECT id, receiving_id
       FROM receiving_lines
       WHERE id = $1
       LIMIT 1`,
      [receivingLineId],
    );
    if (lineRes.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: `receiving_line ${receivingLineId} not found` },
        { status: 404 },
      );
    }

    const lineReceivingId = lineRes.rows[0]?.receiving_id ?? null;

    const inserted = await pool.query<SerialRow>(
      `INSERT INTO tech_serial_numbers
         (serial_number, serial_type, tested_by, station_source, receiving_line_id, shipment_id, scan_ref)
       VALUES ($1, $2, $3, 'RECEIVING', $4, NULL, NULL)
       RETURNING id, serial_number, serial_type, tested_by, station_source, receiving_line_id,
                 created_at::text, updated_at::text`,
      [serialNumber, serialType, testedBy, receivingLineId],
    );

    await invalidateCacheTags(['receiving-lines', 'receiving-logs']);
    if (lineReceivingId != null) {
      await publishReceivingLogChanged({
        action: 'update',
        rowId: String(lineReceivingId),
        source: 'receiving.serials.create',
      });
    }

    return NextResponse.json(
      { success: true, serial: normalizeRow(inserted.rows[0]) },
      { status: 201 },
    );
  } catch (error: any) {
    if (error?.code === '23505') {
      return NextResponse.json(
        { success: false, error: 'Serial already exists for this receiving line' },
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : 'Failed to create receiving serial';
    console.error('receiving/serials POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get('id'));

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid id is required' },
        { status: 400 },
      );
    }

    const deleted = await pool.query<{ id: number; receiving_line_id: number | null; receiving_id: number | null }>(
      `DELETE FROM tech_serial_numbers tsn
       USING receiving_lines rl
       WHERE tsn.id = $1
         AND tsn.station_source = 'RECEIVING'
         AND rl.id = tsn.receiving_line_id
       RETURNING tsn.id, tsn.receiving_line_id, rl.receiving_id`,
      [id],
    );

    if (deleted.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Receiving serial not found' },
        { status: 404 },
      );
    }

    await invalidateCacheTags(['receiving-lines', 'receiving-logs']);
    if (deleted.rows[0]?.receiving_id != null) {
      await publishReceivingLogChanged({
        action: 'update',
        rowId: String(deleted.rows[0].receiving_id),
        source: 'receiving.serials.delete',
      });
    }
    return NextResponse.json({ success: true, id: Number(deleted.rows[0].id) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete receiving serial';
    console.error('receiving/serials DELETE failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
