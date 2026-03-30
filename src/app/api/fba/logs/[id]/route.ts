import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { publishFbaItemChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

type Params = Promise<{ id: string }>;

// ── GET /api/fba/logs/[id] ────────────────────────────────────────────────────
// Returns a single fba_fnsku_log row with joined metadata.
export async function GET(
  _request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const { id } = await params;
    const logId = Number(id);
    if (!Number.isFinite(logId) || logId < 1) {
      return NextResponse.json({ success: false, error: 'Invalid log id' }, { status: 400 });
    }

    const result = await pool.query(
      `SELECT
         l.id,
         l.fnsku,
         l.source_stage,
         l.event_type,
         l.staff_id,
         s.name              AS staff_name,
         l.tech_serial_number_id,
         l.fba_shipment_id,
         fs.shipment_ref,
         l.fba_shipment_item_id,
         l.quantity,
         l.station,
         l.notes,
         l.metadata,
         l.created_at,
         ff.product_title,
         ff.asin,
         ff.sku
       FROM fba_fnsku_logs l
       LEFT JOIN staff s          ON s.id    = l.staff_id
       LEFT JOIN fba_fnskus ff    ON ff.fnsku = l.fnsku
       LEFT JOIN fba_shipments fs ON fs.id   = l.fba_shipment_id
       WHERE l.id = $1`,
      [logId]
    );

    if (!result.rows[0]) {
      return NextResponse.json({ success: false, error: 'Log not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, log: result.rows[0] });
  } catch (error: any) {
    console.error('[GET /api/fba/logs/[id]]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch log' },
      { status: 500 }
    );
  }
}

// ── DELETE /api/fba/logs/[id] ─────────────────────────────────────────────────
// Void a log entry by inserting a compensating VOID log row.
// The original row is never hard-deleted (immutable audit trail).
// Query params: staff_id (required), reason (optional note)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Params }
) {
  const client = await pool.connect();
  try {
    const { id } = await params;
    const logId = Number(id);
    if (!Number.isFinite(logId) || logId < 1) {
      return NextResponse.json({ success: false, error: 'Invalid log id' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const staffId = searchParams.get('staff_id') ? Number(searchParams.get('staff_id')) : null;
    const reason = searchParams.get('reason') ? String(searchParams.get('reason')).trim() : null;

    if (!staffId || !Number.isFinite(staffId)) {
      return NextResponse.json(
        { success: false, error: 'staff_id query param is required' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    const original = await client.query(
      `SELECT id, fnsku, source_stage, event_type, staff_id, fba_shipment_id,
              fba_shipment_item_id, quantity, station, metadata
       FROM fba_fnsku_logs
       WHERE id = $1`,
      [logId]
    );

    if (!original.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Log not found' }, { status: 404 });
    }

    const orig = original.rows[0];

    // Block double-voiding
    if (orig.event_type === 'VOID') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, error: 'This log entry is already a VOID record' },
        { status: 409 }
      );
    }

    // Verify voiding staff exists
    const staffCheck = await client.query(`SELECT id, name FROM staff WHERE id = $1`, [staffId]);
    if (!staffCheck.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Staff not found' }, { status: 404 });
    }

    const voidMetadata = {
      voided_log_id: logId,
      original_event_type: orig.event_type,
      original_source_stage: orig.source_stage,
      original_quantity: orig.quantity,
      ...(reason ? { reason } : {}),
    };

    const voidRes = await client.query(
      `INSERT INTO fba_fnsku_logs
         (fnsku, source_stage, event_type, staff_id,
          fba_shipment_id, fba_shipment_item_id, quantity, station, notes, metadata)
       VALUES ($1, $2, 'VOID', $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING *`,
      [
        orig.fnsku,
        orig.source_stage,
        staffId,
        orig.fba_shipment_id,
        orig.fba_shipment_item_id,
        orig.quantity,
        orig.station,
        reason ? `Void of log #${logId}: ${reason}` : `Void of log #${logId}`,
        JSON.stringify(voidMetadata),
      ]
    );

    await client.query('COMMIT');

    await invalidateCacheTags(['fba-logs']);
    await publishFbaItemChanged({ action: 'delete', shipmentId: 0, source: 'fba.logs.void' });

    return NextResponse.json({
      success: true,
      message: `Log #${logId} has been voided`,
      void_log: voidRes.rows[0],
      voided_by: staffCheck.rows[0].name,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[DELETE /api/fba/logs/[id]]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to void log' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
