/**
 * Support follow-up inbox — tickets assigned to a staffer in-app (distinct from
 * the Zendesk assignee). Backs GET /api/inbox/support for the notifications bell.
 */

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export type SupportFollowupInboxRow = {
  ticketId: number;
  subject: string | null;
  assignedStaffId: number;
  assignedStaffName: string;
  assignedByStaffId: number | null;
  assignedByStaffName: string | null;
  updatedAtMs: number;
};

/** Open in-website ticket assignments owned by `staffId`, newest first. */
export async function listSupportFollowupsForStaff(
  organizationId: OrgId,
  staffId: number,
): Promise<SupportFollowupInboxRow[]> {
  const r = await tenantQuery<{
    ticket_id: string;
    subject: string | null;
    assigned_staff_id: number;
    assigned_staff_name: string;
    assigned_by_staff_id: number | null;
    assigned_by_staff_name: string | null;
    updated_at_ms: string;
  }>(
    organizationId,
    `SELECT a.zendesk_ticket_id::bigint AS ticket_id,
            st.subject_cache AS subject,
            a.assigned_staff_id::int AS assigned_staff_id,
            assignee.name AS assigned_staff_name,
            a.assigned_by::int AS assigned_by_staff_id,
            assigner.name AS assigned_by_staff_name,
            (EXTRACT(EPOCH FROM a.updated_at) * 1000)::bigint AS updated_at_ms
       FROM support_ticket_assignments a
       JOIN staff assignee ON assignee.id = a.assigned_staff_id
       LEFT JOIN staff assigner ON assigner.id = a.assigned_by
       LEFT JOIN support_tickets st
         ON st.organization_id = a.organization_id
        AND st.provider = 'zendesk'
        AND st.external_ticket_id = a.zendesk_ticket_id::text
      WHERE a.organization_id = $1
        AND a.assigned_staff_id = $2
      ORDER BY a.updated_at DESC
      LIMIT 50`,
    [organizationId, staffId],
  );

  return r.rows.map((row) => ({
    ticketId: Number(row.ticket_id),
    subject: row.subject,
    assignedStaffId: Number(row.assigned_staff_id),
    assignedStaffName: String(row.assigned_staff_name ?? `Staff #${row.assigned_staff_id}`),
    assignedByStaffId: row.assigned_by_staff_id != null ? Number(row.assigned_by_staff_id) : null,
    assignedByStaffName:
      row.assigned_by_staff_name != null ? String(row.assigned_by_staff_name) : null,
    updatedAtMs: Number(row.updated_at_ms) || 0,
  }));
}
