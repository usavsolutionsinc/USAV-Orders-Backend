import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { formatPSTTimestamp } from '@/utils/date';
import { publishActivityLogged, publishTechLogChanged } from '@/lib/realtime/publish';
import { createStationActivityLog } from '@/lib/station-activity';
import { mergeSerialsFromTsnRows } from '@/lib/tech/serialFields';

type Action = 'add' | 'remove' | 'update' | 'undo';

function normalizeSerial(s: unknown): string {
  return String(s || '').trim().toUpperCase();
}

/** Get the anchor SAL row for this session. */
async function getSalRow(db: typeof pool, salId: number) {
  const r = await db.query(
    `SELECT id, staff_id, shipment_id, scan_ref, fnsku, orders_exception_id,
            fba_shipment_id, fba_shipment_item_id
     FROM station_activity_logs WHERE id = $1`,
    [salId],
  );
  return r.rows[0] ?? null;
}

/** Get all serials for a SAL anchor. */
async function getSerials(db: typeof pool, salId: number): Promise<string[]> {
  const r = await db.query(
    `SELECT serial_number FROM tech_serial_numbers
     WHERE context_station_activity_log_id = $1 ORDER BY id`,
    [salId],
  );
  return mergeSerialsFromTsnRows(r.rows);
}

/** Detect serial type from value and context. */
function detectSerialType(serial: string, fnsku: string | null): string {
  if (/^X0|^B0/i.test(serial)) return 'FNSKU';
  if (fnsku) return 'FNSKU';
  return 'SERIAL';
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });

  const action = String(body.action || '').toLowerCase() as Action;
  const salId = Number(body.salId);
  const techId = Number(body.techId);

  if (!['add', 'remove', 'update', 'undo'].includes(action)) {
    return NextResponse.json({ success: false, error: 'action must be add|remove|update|undo' }, { status: 400 });
  }
  if (!Number.isFinite(salId) || salId <= 0) {
    return NextResponse.json({ success: false, error: 'salId is required' }, { status: 400 });
  }
  if (!Number.isFinite(techId) || techId <= 0) {
    return NextResponse.json({ success: false, error: 'techId is required' }, { status: 400 });
  }

  try {
    // Resolve staff
    const staffResult = await pool.query(`SELECT id FROM staff WHERE id = $1 LIMIT 1`, [techId]);
    if (staffResult.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Staff not found' }, { status: 404 });
    }
    const staffId = staffResult.rows[0].id;

    // Validate SAL row exists
    const sal = await getSalRow(pool, salId);
    if (!sal) {
      return NextResponse.json({ success: false, error: 'Scan session not found' }, { status: 404 });
    }

    const fnsku = sal.fnsku || null;
    const isFba = Boolean(fnsku);

    if (action === 'add') {
      const serial = normalizeSerial(body.serial);
      if (!serial) return NextResponse.json({ success: false, error: 'serial is required' }, { status: 400 });

      const serialType = detectSerialType(serial, fnsku);

      // Check duplicate (unless FBA which allows duplicates)
      if (!isFba) {
        const dup = await pool.query(
          `SELECT 1 FROM tech_serial_numbers
           WHERE context_station_activity_log_id = $1 AND UPPER(TRIM(serial_number)) = $2 LIMIT 1`,
          [salId, serial],
        );
        if (dup.rows.length > 0) {
          return NextResponse.json({ success: false, error: `Serial ${serial} already scanned for this order` }, { status: 400 });
        }
      }

      // Insert TSN row — only serial + link to SAL
      const insertResult = await pool.query(
        `INSERT INTO tech_serial_numbers
         (serial_number, serial_type, tested_by, context_station_activity_log_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [serial, serialType, staffId, salId],
      );
      const tsnId = insertResult.rows[0]?.id ? Number(insertResult.rows[0].id) : null;

      // Create SERIAL_ADDED SAL row
      let serialSalId: number | null = null;
      if (tsnId) {
        serialSalId = await createStationActivityLog(pool, {
          station: 'TECH',
          activityType: 'SERIAL_ADDED',
          staffId,
          shipmentId: sal.shipment_id ?? null,
          scanRef: sal.scan_ref ?? null,
          fnsku,
          ordersExceptionId: sal.orders_exception_id ?? null,
          fbaShipmentId: sal.fba_shipment_id ?? null,
          fbaShipmentItemId: sal.fba_shipment_item_id ?? null,
          techSerialNumberId: tsnId,
          notes: `Serial added: ${serial}`,
          metadata: { serial, serial_type: serialType },
          createdAt: formatPSTTimestamp(),
        }) ?? null;
      }

      await invalidateCacheTags(['tech-logs', 'orders-next']);
      await publishTechLogChanged({ techId: staffId, action: 'insert', source: 'tech.serial' });
      if (serialSalId) publishActivityLogged({ id: serialSalId, station: 'TECH', activityType: 'SERIAL_ADDED', staffId, scanRef: sal.scan_ref ?? null, fnsku, source: 'tech.serial' }).catch(() => {});

      const serialNumbers = await getSerials(pool, salId);
      return NextResponse.json({ success: true, serialNumbers, tsnId });
    }

    if (action === 'remove') {
      const tsnId = Number(body.tsnId);
      if (!Number.isFinite(tsnId) || tsnId <= 0) {
        return NextResponse.json({ success: false, error: 'tsnId is required for remove' }, { status: 400 });
      }

      // Delete SAL rows referencing this TSN
      await pool.query(
        `DELETE FROM station_activity_logs WHERE tech_serial_number_id = $1 AND activity_type = 'SERIAL_ADDED'`,
        [tsnId],
      );
      // Delete the TSN row
      await pool.query(`DELETE FROM tech_serial_numbers WHERE id = $1 AND context_station_activity_log_id = $2`, [tsnId, salId]);

      await invalidateCacheTags(['tech-logs', 'orders-next']);
      await publishTechLogChanged({ techId: staffId, action: 'update', source: 'tech.serial' });

      const serialNumbers = await getSerials(pool, salId);
      return NextResponse.json({ success: true, serialNumbers });
    }

    if (action === 'update') {
      // Full sync: caller sends desired final set of serials
      const desiredRaw: unknown[] = Array.isArray(body.serials) ? body.serials : [];
      const normalized = desiredRaw.map(normalizeSerial).filter(Boolean);
      const desired: string[] = Array.from(new Set(normalized));

      const existing = await pool.query(
        `SELECT id, UPPER(TRIM(serial_number)) AS serial FROM tech_serial_numbers
         WHERE context_station_activity_log_id = $1 ORDER BY id`,
        [salId],
      );
      const existingMap = new Map<string, number>();
      for (const row of existing.rows) existingMap.set(row.serial, row.id);

      const desiredSet = new Set(desired);

      // Delete removed
      for (const [serial, id] of existingMap) {
        if (!desiredSet.has(serial)) {
          await pool.query(`DELETE FROM station_activity_logs WHERE tech_serial_number_id = $1 AND activity_type = 'SERIAL_ADDED'`, [id]);
          await pool.query(`DELETE FROM tech_serial_numbers WHERE id = $1`, [id]);
        }
      }

      // Insert new
      for (const serial of desired) {
        if (!existingMap.has(serial)) {
          const serialType = detectSerialType(serial, fnsku);
          const ins = await pool.query(
            `INSERT INTO tech_serial_numbers
             (serial_number, serial_type, tested_by, context_station_activity_log_id)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [serial, serialType, staffId, salId],
          );
          const tsnId = ins.rows[0]?.id ? Number(ins.rows[0].id) : null;
          if (tsnId) {
            const updateSalId = await createStationActivityLog(pool, {
              station: 'TECH',
              activityType: 'SERIAL_ADDED',
              staffId,
              shipmentId: sal.shipment_id ?? null,
              fnsku,
              techSerialNumberId: tsnId,
              notes: `Serial added from update: ${serial}`,
              metadata: { serial, serial_type: serialType, source: 'tech.serial.update' },
            });
            if (updateSalId) publishActivityLogged({ id: updateSalId, station: 'TECH', activityType: 'SERIAL_ADDED', staffId, scanRef: sal.scan_ref ?? null, fnsku, source: 'tech.serial.update' }).catch(() => {});
          }
        }
      }

      await invalidateCacheTags(['tech-logs', 'orders-next']);
      await publishTechLogChanged({ techId: staffId, action: 'update', source: 'tech.serial' });

      const serialNumbers = await getSerials(pool, salId);
      return NextResponse.json({ success: true, serialNumbers });
    }

    if (action === 'undo') {
      // Remove the last TSN row
      const last = await pool.query(
        `SELECT id, serial_number FROM tech_serial_numbers
         WHERE context_station_activity_log_id = $1 ORDER BY id DESC LIMIT 1`,
        [salId],
      );
      if (last.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'No serials to undo' }, { status: 400 });
      }
      const lastRow = last.rows[0];
      await pool.query(`DELETE FROM station_activity_logs WHERE tech_serial_number_id = $1 AND activity_type = 'SERIAL_ADDED'`, [lastRow.id]);
      await pool.query(`DELETE FROM tech_serial_numbers WHERE id = $1`, [lastRow.id]);

      await invalidateCacheTags(['tech-logs', 'orders-next']);
      await publishTechLogChanged({ techId: staffId, action: 'update', source: 'tech.serial' });

      const serialNumbers = await getSerials(pool, salId);
      return NextResponse.json({ success: true, serialNumbers, removedSerial: lastRow.serial_number });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    console.error('Error in tech serial:', error);
    return NextResponse.json({ success: false, error: 'Failed', details: error.message }, { status: 500 });
  }
}
