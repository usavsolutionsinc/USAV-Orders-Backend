import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishTechLogChanged } from '@/lib/realtime/publish';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * Simplified delete: SAL is SoT, cascade to TSN + fba_fnsku_logs.
 * Body: { salId: number }
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });

  const salId = Number(body.salId);
  if (!Number.isFinite(salId) || salId <= 0) {
    return NextResponse.json({ success: false, error: 'salId is required' }, { status: 400 });
  }

  try {
    // Verify SAL row exists (org-scoped) and get staff for cache invalidation
    const salRow = await tenantQuery(
      ctx.organizationId,
      `SELECT id, staff_id, fnsku FROM station_activity_logs WHERE id = $1 AND organization_id = $2`,
      [salId, ctx.organizationId],
    );
    if (salRow.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Scan session not found' }, { status: 404 });
    }
    const staffId = salRow.rows[0].staff_id;

    const deletedSerialCount = await withTenantTransaction(ctx.organizationId, async (client) => {
      // 1. Delete SERIAL_ADDED SAL rows that reference TSN rows for this session
      await client.query(
        `DELETE FROM station_activity_logs
         WHERE activity_type = 'SERIAL_ADDED'
           AND organization_id = $2
           AND tech_serial_number_id IN (
             SELECT id FROM tech_serial_numbers
             WHERE context_station_activity_log_id = $1 AND organization_id = $2
           )`,
        [salId, ctx.organizationId],
      );

      // 2. Delete TSN rows linked to this SAL
      const deletedTsn = await client.query(
        `DELETE FROM tech_serial_numbers WHERE context_station_activity_log_id = $1 AND organization_id = $2`,
        [salId, ctx.organizationId],
      );

      // 3. Delete fba_fnsku_logs linked to this SAL
      await client.query(
        `DELETE FROM fba_fnsku_logs WHERE station_activity_log_id = $1 AND organization_id = $2`,
        [salId, ctx.organizationId],
      );

      // 4. Delete the anchor SAL row itself
      await client.query(
        `DELETE FROM station_activity_logs WHERE id = $1 AND organization_id = $2`,
        [salId, ctx.organizationId],
      );

      return deletedTsn.rowCount ?? 0;
    });

    await invalidateCacheTags(['tech-logs', 'orders-next', 'shipped', 'orders']);
    if (staffId) {
      await publishTechLogChanged({ organizationId: ctx.organizationId, techId: staffId, action: 'delete', source: 'tech.delete' });
    }

    return NextResponse.json({ success: true, deletedSerials: deletedSerialCount });
  } catch (error: any) {
    console.error('Error in tech delete:', error);
    return NextResponse.json({ success: false, error: 'Delete failed', details: error.message }, { status: 500 });
  }
}, { permission: 'tech.scan_serial' });
