import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishTechLogChanged } from '@/lib/realtime/publish';
import {
  getTechSerialsBySalId,
  insertTechSerialForSalContext,
  normalizeTechSerial,
  resolveTechSerialSalContext,
} from '@/lib/tech/insertTechSerialForSalContext';

type Action = 'add' | 'remove' | 'update' | 'undo';

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

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const salCtxResult = await resolveTechSerialSalContext(client, salId);
      if (!salCtxResult.ok) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { success: false, error: salCtxResult.error },
          { status: salCtxResult.status },
        );
      }
      const salCtx = salCtxResult.ctx;

      if (action === 'add') {
        const serial = normalizeTechSerial(body.serial);
        const ins = await insertTechSerialForSalContext(client, {
          salContext: salCtx,
          staffId,
          serial,
          source: 'tech.serial',
          sourceMethod: 'SCAN',
        });
        if (!ins.ok) {
          await client.query('ROLLBACK');
          return NextResponse.json({ success: false, error: ins.error }, { status: ins.status });
        }

        const serialNumbers = await getTechSerialsBySalId(client, salId);
        await client.query('COMMIT');

        await invalidateCacheTags(['tech-logs', 'orders-next']);
        await publishTechLogChanged({ techId: staffId, action: 'insert', source: 'tech.serial' });

        return NextResponse.json({ success: true, serialNumbers, tsnId: ins.techSerialId });
      }

      if (action === 'remove') {
        const tsnId = Number(body.tsnId);
        if (!Number.isFinite(tsnId) || tsnId <= 0) {
          await client.query('ROLLBACK');
          return NextResponse.json({ success: false, error: 'tsnId is required for remove' }, { status: 400 });
        }

        await client.query(
          `DELETE FROM station_activity_logs WHERE tech_serial_number_id = $1 AND activity_type = 'SERIAL_ADDED'`,
          [tsnId],
        );
        await client.query(`DELETE FROM tech_serial_numbers WHERE id = $1 AND context_station_activity_log_id = $2`, [tsnId, salId]);

        const serialNumbers = await getTechSerialsBySalId(client, salId);
        await client.query('COMMIT');

        await invalidateCacheTags(['tech-logs', 'orders-next']);
        await publishTechLogChanged({ techId: staffId, action: 'update', source: 'tech.serial' });

        return NextResponse.json({ success: true, serialNumbers });
      }

      if (action === 'update') {
        const desiredRaw: unknown[] = Array.isArray(body.serials) ? body.serials : [];
        const desired = Array.from(new Set(desiredRaw.map(normalizeTechSerial).filter(Boolean)));

        const existing = await client.query(
          `SELECT id, UPPER(TRIM(serial_number)) AS serial FROM tech_serial_numbers
           WHERE context_station_activity_log_id = $1 ORDER BY id`,
          [salId],
        );
        const existingMap = new Map<string, number>();
        for (const row of existing.rows) existingMap.set(row.serial, row.id);

        const desiredSet = new Set(desired);

        for (const [serial, id] of existingMap) {
          if (!desiredSet.has(serial)) {
            await client.query(`DELETE FROM station_activity_logs WHERE tech_serial_number_id = $1 AND activity_type = 'SERIAL_ADDED'`, [id]);
            await client.query(`DELETE FROM tech_serial_numbers WHERE id = $1`, [id]);
          }
        }

        for (const serial of desired) {
          if (existingMap.has(serial)) continue;
          const ins = await insertTechSerialForSalContext(client, {
            salContext: salCtx,
            staffId,
            serial,
            source: 'tech.serial.update',
            sourceMethod: 'SCAN',
          });
          if (!ins.ok) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, error: ins.error }, { status: ins.status });
          }
        }

        const serialNumbers = await getTechSerialsBySalId(client, salId);
        await client.query('COMMIT');

        await invalidateCacheTags(['tech-logs', 'orders-next']);
        await publishTechLogChanged({ techId: staffId, action: 'update', source: 'tech.serial' });

        return NextResponse.json({ success: true, serialNumbers });
      }

      if (action === 'undo') {
        const last = await client.query(
          `SELECT id, serial_number FROM tech_serial_numbers
           WHERE context_station_activity_log_id = $1 ORDER BY id DESC LIMIT 1`,
          [salId],
        );
        if (last.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json({ success: false, error: 'No serials to undo' }, { status: 400 });
        }
        const lastRow = last.rows[0];
        await client.query(`DELETE FROM station_activity_logs WHERE tech_serial_number_id = $1 AND activity_type = 'SERIAL_ADDED'`, [lastRow.id]);
        await client.query(`DELETE FROM tech_serial_numbers WHERE id = $1`, [lastRow.id]);

        const serialNumbers = await getTechSerialsBySalId(client, salId);
        await client.query('COMMIT');

        await invalidateCacheTags(['tech-logs', 'orders-next']);
        await publishTechLogChanged({ techId: staffId, action: 'update', source: 'tech.serial' });

        return NextResponse.json({ success: true, serialNumbers, removedSerial: lastRow.serial_number });
      }

      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('Error in tech serial:', error);
      return NextResponse.json({ success: false, error: 'Failed', details: error.message }, { status: 500 });
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error in tech serial:', error);
    return NextResponse.json({ success: false, error: 'Failed', details: error.message }, { status: 500 });
  }
}
