import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/utils/date';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishRepairChanged } from '@/lib/realtime/publish';

interface RepairLookupRow {
  id: number;
  ticket_number: string | null;
  status: string | null;
}

interface WorkAssignmentRow {
  id: number;
}

function parseScanInput(rawValue: unknown) {
  const raw = String(rawValue ?? '').trim();
  if (!raw) {
    return {
      raw,
      repairId: null as number | null,
      ticketCandidate: null as string | null,
    };
  }

  const compactUpper = raw.replace(/\s+/g, '').toUpperCase();
  let repairId: number | null = null;

  const rsMatch = compactUpper.match(/^RS(?:-|_|:|#)?0*(\d+)$/);
  if (rsMatch?.[1]) {
    const numeric = Number(rsMatch[1]);
    repairId = Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  } else if (/^\d+$/.test(compactUpper)) {
    const numeric = Number(compactUpper);
    repairId = Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }

  const ticketCandidate = raw.replace(/^#/, '').trim() || null;

  return {
    raw,
    repairId,
    ticketCandidate,
  };
}

/**
 * POST /api/repair-service/pickup
 *
 * Body:
 * {
 *   scan: string // RS-ID barcode/input (examples: RS-125, 125, ticket number)
 * }
 *
 * Effect:
 * 1. Marks repair_service.status as Done
 * 2. Appends a status_history entry when status changed
 * 3. Marks REPAIR work assignment status as DONE for work-orders queue parity
 */
export async function POST(req: NextRequest) {
  const client = await pool.connect();

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = parseScanInput(body?.scan ?? body?.rsId ?? body?.value);

    if (!parsed.raw) {
      return NextResponse.json({ error: 'scan value is required' }, { status: 400 });
    }

    await client.query('BEGIN');

    let repair: RepairLookupRow | null = null;

    if (parsed.repairId != null) {
      const byId = await client.query<RepairLookupRow>(
        `SELECT id, ticket_number, status
         FROM repair_service
         WHERE id = $1
         FOR UPDATE`,
        [parsed.repairId],
      );
      repair = byId.rows[0] ?? null;
    }

    if (!repair && parsed.ticketCandidate) {
      const byTicket = await client.query<RepairLookupRow>(
        `SELECT id, ticket_number, status
         FROM repair_service
         WHERE UPPER(TRIM(COALESCE(ticket_number, ''))) = UPPER(TRIM($1))
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [parsed.ticketCandidate],
      );
      repair = byTicket.rows[0] ?? null;
    }

    if (!repair) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Repair not found for scan "${parsed.raw}"` },
        { status: 404 },
      );
    }

    const repairId = Number(repair.id);
    const previousStatus = String(repair.status || '').trim() || null;

    await client.query(
      `UPDATE repair_service
          SET status = 'Done',
              status_history = CASE
                WHEN COALESCE(status, '') IS DISTINCT FROM 'Done' THEN
                  COALESCE(status_history, '[]'::jsonb) || jsonb_build_array(
                    jsonb_strip_nulls(
                      jsonb_build_object(
                        'status', 'Done',
                        'timestamp', $2,
                        'previous_status', NULLIF(status, ''),
                        'source', 'repair-service.pickup-scan',
                        'metadata', jsonb_build_object(
                          'scan_input', $3,
                          'action', 'picked_up_scan'
                        )
                      )
                    )
                  )
                ELSE COALESCE(status_history, '[]'::jsonb)
              END,
              updated_at = NOW()
        WHERE id = $1`,
      [repairId, formatPSTTimestamp(), parsed.raw],
    );

    const activeAssignment = await client.query<WorkAssignmentRow>(
      `SELECT id
       FROM work_assignments
       WHERE entity_type = 'REPAIR'
         AND entity_id = $1
         AND work_type = 'REPAIR'
         AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
       ORDER BY CASE status
         WHEN 'IN_PROGRESS' THEN 1
         WHEN 'ASSIGNED' THEN 2
         WHEN 'OPEN' THEN 3
         ELSE 4
       END, updated_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [repairId],
    );

    let assignmentId: number | null = null;

    if (activeAssignment.rows[0]) {
      assignmentId = Number(activeAssignment.rows[0].id);
      await client.query(
        `UPDATE work_assignments
            SET status = 'DONE',
                started_at = COALESCE(started_at, NOW()),
                completed_at = COALESCE(completed_at, NOW()),
                updated_at = NOW()
          WHERE id = $1`,
        [assignmentId],
      );
    } else {
      const doneAssignment = await client.query<WorkAssignmentRow>(
        `SELECT id
         FROM work_assignments
         WHERE entity_type = 'REPAIR'
           AND entity_id = $1
           AND work_type = 'REPAIR'
           AND status = 'DONE'
         ORDER BY completed_at DESC NULLS LAST, updated_at DESC, id DESC
         LIMIT 1
         FOR UPDATE`,
        [repairId],
      );

      if (doneAssignment.rows[0]) {
        assignmentId = Number(doneAssignment.rows[0].id);
        await client.query(
          `UPDATE work_assignments
              SET completed_at = COALESCE(completed_at, NOW()),
                  updated_at = NOW()
            WHERE id = $1`,
          [assignmentId],
        );
      } else {
        const inserted = await client.query<WorkAssignmentRow>(
          `INSERT INTO work_assignments
                (entity_type, entity_id, work_type, status, priority, assigned_at, started_at, completed_at)
           VALUES ('REPAIR', $1, 'REPAIR', 'DONE', 100, NOW(), NOW(), NOW())
           RETURNING id`,
          [repairId],
        );
        assignmentId = inserted.rows[0] ? Number(inserted.rows[0].id) : null;
      }
    }

    await client.query('COMMIT');

    await invalidateCacheTags(['repair-service']);
    await publishRepairChanged({
      repairIds: [repairId],
      source: 'repair-service.pickup-scan',
    });

    return NextResponse.json({
      success: true,
      repairId,
      ticketNumber: repair.ticket_number ?? null,
      status: 'Done',
      previousStatus,
      assignmentId,
      alreadyDone: previousStatus === 'Done',
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('POST /api/repair-service/pickup error:', error);
    return NextResponse.json(
      {
        error: 'Failed to mark repair as picked up',
        details: error?.message || 'Unknown error',
      },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
