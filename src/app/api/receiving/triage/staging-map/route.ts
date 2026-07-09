import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * GET /api/receiving/triage/staging-map — every carton with a shelf and/or
 * lane assigned (staged, whether or not triage is complete yet), for the
 * rail-row "Shelf · Lane" popover chip (A3, docs/receiving-triage-redesign-plan.md
 * §4). Same side-channel annotation pattern as `useTriageStagedCartons` / the B3
 * Zoho-sync exception dot — a read-only indexed lookup, never a blocking fetch.
 */
interface StagingMapRow {
  id: number;
  staging_location_id: number | null;
  location_name: string | null;
  location_room: string | null;
  priority_lane: string | null;
  triage_complete: boolean;
}

export const GET = withAuth(async (_request: NextRequest, ctx) => {
  const sql = `
    SELECT
      r.id,
      r.staging_location_id,
      l.name AS location_name,
      l.room AS location_room,
      r.priority_lane,
      r.triage_complete
    FROM receiving r
    LEFT JOIN locations l ON l.id = r.staging_location_id
    WHERE r.organization_id = $1
      AND (r.staging_location_id IS NOT NULL OR r.priority_lane IS NOT NULL OR r.triage_complete = true)
    ORDER BY r.triage_completed_at DESC NULLS LAST, r.updated_at DESC NULLS LAST
    LIMIT 500
  `;

  const result = await tenantQuery<StagingMapRow>(ctx.organizationId, sql, [ctx.organizationId]);

  return NextResponse.json({ success: true, rows: result.rows });
}, { permission: 'receiving.view' });
