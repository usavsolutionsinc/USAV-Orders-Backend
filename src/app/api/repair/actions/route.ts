import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishRepairChanged } from '@/lib/realtime/publish';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import { USAV_ORG_ID } from '@/lib/tenancy/constants';

const VALID_ACTION_TYPES = new Set<string>([
  'replaced',
  'repaired',
  'cleaned',
  'tested',
  'no_fix',
  'awaiting_part',
]);

export interface RepairActionRecord {
  id: number;
  repair_id: number;
  action_type: string;
  part_name: string | null;
  old_sku: string | null;
  new_sku: string | null;
  old_serial: string | null;
  new_serial: string | null;
  duration_min: number | null;
  notes: string | null;
  staff_id: number | null;
  staff_name: string | null;
  created_at: string;
}

function normString(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s || null;
}

function normInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/**
 * GET /api/repair/actions?repairId={id}
 *
 * Returns newest-first actions for a repair, excluding soft-deleted rows.
 * Joined with staff for display names.
 */
export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    const orgId = ctx.organizationId ?? USAV_ORG_ID;
    const repairId = Number(req.nextUrl.searchParams.get('repairId'));
    if (!Number.isFinite(repairId) || repairId <= 0) {
      return NextResponse.json({ error: 'repairId is required' }, { status: 400 });
    }

    try {
      const result = await tenantQuery<RepairActionRecord>(
        orgId,
        `SELECT a.id, a.repair_id, a.action_type, a.part_name,
                a.old_sku, a.new_sku, a.old_serial, a.new_serial,
                a.duration_min, a.notes, a.staff_id,
                s.name AS staff_name,
                a.created_at
           FROM repair_actions a
           LEFT JOIN staff s ON s.id = a.staff_id
          WHERE a.repair_id = $1
            AND a.deleted_at IS NULL
          ORDER BY a.created_at DESC, a.id DESC`,
        [repairId],
      );
      return NextResponse.json({ actions: result.rows });
    } catch (error: any) {
      console.error('GET /api/repair/actions error:', error);
      return NextResponse.json(
        { error: 'Failed to load repair actions', details: error?.message },
        { status: 500 },
      );
    }
  },
  { permission: 'repair.view' },
);

/**
 * POST /api/repair/actions
 *
 * Body: { repairId, actionType, partName?, oldSku?, newSku?, oldSerial?,
 *         newSerial?, durationMin?, notes? }
 *
 * staff_id is taken from the session — never trusted from the body.
 */
export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    const orgId = ctx.organizationId ?? USAV_ORG_ID;
    const body = await req.json().catch(() => ({}));
    const repairId = Number(body?.repairId);
    const actionType = String(body?.actionType ?? '').trim().toLowerCase();

    if (!Number.isFinite(repairId) || repairId <= 0) {
      return NextResponse.json({ error: 'repairId is required' }, { status: 400 });
    }
    if (!VALID_ACTION_TYPES.has(actionType)) {
      return NextResponse.json(
        { error: `Invalid actionType. Expected one of: ${Array.from(VALID_ACTION_TYPES).join(', ')}` },
        { status: 400 },
      );
    }

    try {
      const fetched = await withTenantTransaction(orgId, async (client) => {
        const inserted = await client.query<{ id: number }>(
          `INSERT INTO repair_actions
              (repair_id, action_type, part_name, old_sku, new_sku,
               old_serial, new_serial, duration_min, notes, staff_id, organization_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   (SELECT organization_id FROM unit_repairs WHERE id = $1))
           RETURNING id`,
          [
            repairId,
            actionType,
            normString(body?.partName),
            normString(body?.oldSku),
            normString(body?.newSku),
            normString(body?.oldSerial),
            normString(body?.newSerial),
            normInt(body?.durationMin),
            normString(body?.notes),
            ctx.staffId,
          ],
        );

        const newId = inserted.rows[0]?.id;
        return client.query<RepairActionRecord>(
          `SELECT a.id, a.repair_id, a.action_type, a.part_name,
                  a.old_sku, a.new_sku, a.old_serial, a.new_serial,
                  a.duration_min, a.notes, a.staff_id,
                  s.name AS staff_name,
                  a.created_at
             FROM repair_actions a
             LEFT JOIN staff s ON s.id = a.staff_id
            WHERE a.id = $1`,
          [newId],
        );
      });

      await invalidateCacheTags(['repair-service']);
      await publishRepairChanged({
        organizationId: ctx.organizationId,
        repairIds: [repairId],
        source: 'repair.action-logged',
      });

      return NextResponse.json({ success: true, action: fetched.rows[0] });
    } catch (error: any) {
      console.error('POST /api/repair/actions error:', error);
      return NextResponse.json(
        { error: 'Failed to log repair action', details: error?.message },
        { status: 500 },
      );
    }
  },
  { permission: 'repair.mark_repaired' },
);
