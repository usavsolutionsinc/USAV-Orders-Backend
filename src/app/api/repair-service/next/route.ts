import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export interface RepairQueueItem {
  kind: 'REPAIR';
  repairId: number;
  assignmentId: number;
  assignmentStatus: 'ASSIGNED' | 'IN_PROGRESS';
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
}

const CLOSED_STATUSES = ['Done', 'Shipped', 'Picked Up'];

/**
 * GET /api/repair-service/next?techId=<id>
 *
 * Returns repairs assigned (or unassigned) to the given tech that are
 * not yet in a closed status. One SQL query — no N+1.
 */
export async function GET(req: NextRequest) {
  try {
    const techId = req.nextUrl.searchParams.get('techId');

    const closedPlaceholders = CLOSED_STATUSES.map((_, i) => `$${i + 1}`).join(', ');

    let query: string;
    let params: (string | number)[];

    if (techId) {
      query = `
        SELECT
          rs.id              AS "repairId",
          wa.id              AS "assignmentId",
          wa.status          AS "assignmentStatus",
          rs.ticket_number   AS "ticketNumber",
          rs.product_title   AS "productTitle",
          rs.issue,
          rs.serial_number   AS "serialNumber",
          rs.contact_info    AS "contactInfo",
          rs.date_time       AS "dateTime",
          rs.status          AS "repairStatus",
          rs.price,
          wa.assigned_tech_id AS "assignedTechId",
          s.name             AS "techName"
        FROM repair_service rs
        JOIN work_assignments wa
          ON  wa.entity_type = 'REPAIR'
          AND wa.entity_id   = rs.id
          AND wa.work_type   = 'REPAIR'
          AND wa.status      IN ('ASSIGNED', 'IN_PROGRESS')
        LEFT JOIN staff s ON s.id = wa.assigned_tech_id
        WHERE rs.status NOT IN (${closedPlaceholders})
          AND (
                wa.assigned_tech_id = $${CLOSED_STATUSES.length + 1}
             OR wa.assigned_tech_id IS NULL
          )
        ORDER BY wa.priority ASC, rs.id ASC
      `;
      params = [...CLOSED_STATUSES, Number(techId)];
    } else {
      // No techId — return all unresolved assigned repairs
      query = `
        SELECT
          rs.id              AS "repairId",
          wa.id              AS "assignmentId",
          wa.status          AS "assignmentStatus",
          rs.ticket_number   AS "ticketNumber",
          rs.product_title   AS "productTitle",
          rs.issue,
          rs.serial_number   AS "serialNumber",
          rs.contact_info    AS "contactInfo",
          rs.date_time       AS "dateTime",
          rs.status          AS "repairStatus",
          rs.price,
          wa.assigned_tech_id AS "assignedTechId",
          s.name             AS "techName"
        FROM repair_service rs
        JOIN work_assignments wa
          ON  wa.entity_type = 'REPAIR'
          AND wa.entity_id   = rs.id
          AND wa.work_type   = 'REPAIR'
          AND wa.status      IN ('ASSIGNED', 'IN_PROGRESS')
        LEFT JOIN staff s ON s.id = wa.assigned_tech_id
        WHERE rs.status NOT IN (${closedPlaceholders})
        ORDER BY wa.priority ASC, rs.id ASC
      `;
      params = [...CLOSED_STATUSES];
    }

    const result = await pool.query(query, params);

    const repairs: RepairQueueItem[] = result.rows.map((row) => ({
      kind: 'REPAIR' as const,
      repairId: row.repairId,
      assignmentId: row.assignmentId,
      assignmentStatus: row.assignmentStatus,
      ticketNumber: row.ticketNumber || '',
      productTitle: row.productTitle || '',
      issue: row.issue || '',
      serialNumber: row.serialNumber || '',
      contactInfo: row.contactInfo || '',
      dateTime: row.dateTime || '',
      repairStatus: row.repairStatus || '',
      price: row.price || '',
      assignedTechId: row.assignedTechId ?? null,
      techName: row.techName ?? null,
    }));

    return NextResponse.json({ repairs, count: repairs.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('GET /api/repair-service/next error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
