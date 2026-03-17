import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizePSTTimestamp } from '@/utils/date';
import { parsePositiveInt } from '@/utils/number';

export interface RepairQueueItem {
  kind: 'REPAIR';
  repairId: number;
  assignmentId: number | null;
  assignmentStatus: 'ASSIGNED' | 'IN_PROGRESS' | null;
  deadlineAt: string | null;
  ticketNumber: string;
  productTitle: string;
  issue: string;
  serialNumber: string;
  contactInfo: string;
  dateTime: string;
  repairStatus: string;
  price: string;
  assignedTechId: number | null;
  techName: string | null;
  outOfStock: string | null;
  repairOutcome: string | null;
}

const CLOSED_STATUSES = ['Done', 'Shipped', 'Picked Up'];

async function getRepairWorkAssignmentSelects() {
  const columns = await pool.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'work_assignments'
       AND column_name IN ('out_of_stock', 'repair_outcome')`
  );

  const present = new Set(columns.rows.map((row) => row.column_name));

  return {
    outOfStockSelect: present.has('out_of_stock')
      ? `wa.out_of_stock     AS "outOfStock"`
      : `NULL::text          AS "outOfStock"`,
    repairOutcomeSelect: present.has('repair_outcome')
      ? `wa.repair_outcome   AS "repairOutcome"`
      : `NULL::text          AS "repairOutcome"`,
  };
}

/**
 * GET /api/repair-service/next?techId=<id>
 *
 * Returns repairs assigned to the given tech PLUS all unassigned repairs
 * (repairs with no active work_assignment row, or an assignment row with
 * assigned_tech_id IS NULL).  Uses LEFT JOIN so repairs without any
 * work_assignment row are included.
 */
export async function GET(req: NextRequest) {
  try {
    const techIdParam = req.nextUrl.searchParams.get('techId');
    const techId = techIdParam ? parsePositiveInt(techIdParam) : null;
    const { outOfStockSelect, repairOutcomeSelect } = await getRepairWorkAssignmentSelects();

    if (techIdParam && techId === null) {
      return NextResponse.json({ error: 'techId must be a positive integer' }, { status: 400 });
    }

    const closedPlaceholders = CLOSED_STATUSES.map((_, i) => `$${i + 1}`).join(', ');

    let query: string;
    let params: (string | number)[];

    if (techId !== null) {
      query = `
        SELECT
          rs.id               AS "repairId",
          wa.id               AS "assignmentId",
          wa.status           AS "assignmentStatus",
          rs.ticket_number    AS "ticketNumber",
          rs.product_title    AS "productTitle",
          rs.issue,
          rs.serial_number    AS "serialNumber",
          rs.contact_info     AS "contactInfo",
          wa.deadline_at      AS "deadlineAt",
          rs.created_at       AS "dateTime",
          rs.status           AS "repairStatus",
          rs.price,
          wa.assigned_tech_id AS "assignedTechId",
          s.name              AS "techName",
          ${outOfStockSelect},
          ${repairOutcomeSelect}
        FROM repair_service rs
        LEFT JOIN LATERAL (
          SELECT *
          FROM work_assignments
          WHERE entity_type = 'REPAIR'
            AND entity_id   = rs.id
            AND work_type   = 'REPAIR'
            AND status      IN ('ASSIGNED', 'IN_PROGRESS')
            AND completed_at IS NULL
          ORDER BY id DESC
          LIMIT 1
        ) wa ON TRUE
        LEFT JOIN staff s ON s.id = wa.assigned_tech_id
        WHERE rs.status NOT IN (${closedPlaceholders})
          AND NOT EXISTS (
            SELECT 1
            FROM work_assignments wa_done
            WHERE wa_done.entity_type = 'REPAIR'
              AND wa_done.entity_id = rs.id
              AND wa_done.work_type = 'REPAIR'
              AND (
                wa_done.status = 'DONE'
                OR wa_done.completed_at IS NOT NULL
              )
          )
          AND (
               wa.id IS NULL
            OR wa.assigned_tech_id IS NULL
            OR wa.assigned_tech_id = $${CLOSED_STATUSES.length + 1}
          )
        ORDER BY COALESCE(wa.deadline_at, rs.created_at) ASC NULLS LAST, wa.priority ASC NULLS LAST, rs.id ASC
      `;
      params = [...CLOSED_STATUSES, techId];
    } else {
      // No techId — return all unresolved repairs (assigned or not)
      query = `
        SELECT
          rs.id               AS "repairId",
          wa.id               AS "assignmentId",
          wa.status           AS "assignmentStatus",
          rs.ticket_number    AS "ticketNumber",
          rs.product_title    AS "productTitle",
          rs.issue,
          rs.serial_number    AS "serialNumber",
          rs.contact_info     AS "contactInfo",
          wa.deadline_at      AS "deadlineAt",
          rs.created_at       AS "dateTime",
          rs.status           AS "repairStatus",
          rs.price,
          wa.assigned_tech_id AS "assignedTechId",
          s.name              AS "techName",
          ${outOfStockSelect},
          ${repairOutcomeSelect}
        FROM repair_service rs
        LEFT JOIN LATERAL (
          SELECT *
          FROM work_assignments
          WHERE entity_type = 'REPAIR'
            AND entity_id   = rs.id
            AND work_type   = 'REPAIR'
            AND status      IN ('ASSIGNED', 'IN_PROGRESS')
            AND completed_at IS NULL
          ORDER BY id DESC
          LIMIT 1
        ) wa ON TRUE
        LEFT JOIN staff s ON s.id = wa.assigned_tech_id
        WHERE rs.status NOT IN (${closedPlaceholders})
          AND NOT EXISTS (
            SELECT 1
            FROM work_assignments wa_done
            WHERE wa_done.entity_type = 'REPAIR'
              AND wa_done.entity_id = rs.id
              AND wa_done.work_type = 'REPAIR'
              AND (
                wa_done.status = 'DONE'
                OR wa_done.completed_at IS NOT NULL
              )
          )
        ORDER BY COALESCE(wa.deadline_at, rs.created_at) ASC NULLS LAST, wa.priority ASC NULLS LAST, rs.id ASC
      `;
      params = [...CLOSED_STATUSES];
    }

    const result = await pool.query(query, params);

    const repairs: RepairQueueItem[] = result.rows.map((row) => ({
      kind:             'REPAIR' as const,
      repairId:         row.repairId,
      assignmentId:     row.assignmentId ?? null,
      assignmentStatus: row.assignmentStatus ?? null,
      deadlineAt:       normalizePSTTimestamp(row.deadlineAt),
      ticketNumber:     row.ticketNumber || '',
      productTitle:     row.productTitle || '',
      issue:            row.issue || '',
      serialNumber:     row.serialNumber || '',
      contactInfo:      row.contactInfo || '',
      dateTime:         row.dateTime || '',
      repairStatus:     row.repairStatus || '',
      price:            row.price || '',
      assignedTechId:   row.assignedTechId ?? null,
      techName:         row.techName ?? null,
      outOfStock:       row.outOfStock ?? null,
      repairOutcome:    row.repairOutcome ?? null,
    }));

    return NextResponse.json({ repairs, count: repairs.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('GET /api/repair-service/next error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
