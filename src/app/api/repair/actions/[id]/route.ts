import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishRepairChanged } from '@/lib/realtime/publish';

const VALID_ACTION_TYPES = new Set<string>([
  'replaced',
  'repaired',
  'cleaned',
  'tested',
  'no_fix',
  'awaiting_part',
]);

interface ActionRow {
  id: number;
  repair_id: number;
  staff_id: number | null;
}

function normString(v: unknown): string | null {
  if (v === undefined) return undefined as unknown as null; // sentinel: skip
  const s = String(v ?? '').trim();
  return s || null;
}

function normInt(v: unknown): number | null {
  if (v === undefined) return undefined as unknown as null; // sentinel: skip
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

async function loadActionForMutation(
  id: number,
): Promise<ActionRow | null> {
  const r = await pool.query<ActionRow>(
    `SELECT id, repair_id, staff_id
       FROM repair_actions
      WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return r.rows[0] ?? null;
}

function canMutate(action: ActionRow, ctxStaffId: number, ctxRole: string | null | undefined): boolean {
  if (ctxRole === 'admin') return true;
  return action.staff_id === ctxStaffId;
}

/**
 * PATCH /api/repair/actions/[id]
 *
 * Editable fields: actionType, partName, oldSku, newSku, oldSerial, newSerial,
 * durationMin, notes. Author or admin only.
 */
export const PATCH = withAuth(
  async (req, ctx) => {
    // withAuth doesn't forward Next's route ctx; parse the id from the URL.
    const idRaw = req.nextUrl.pathname.split('/').pop() ?? '';
    const id = Number(decodeURIComponent(idRaw));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid action id' }, { status: 400 });
    }

    const existing = await loadActionForMutation(id);
    if (!existing) return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    if (!canMutate(existing, ctx.staffId, ctx.role)) {
      return NextResponse.json({ error: 'Not allowed to edit this action' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const updates: Record<string, unknown> = {};

    if (body.actionType !== undefined) {
      const at = String(body.actionType).trim().toLowerCase();
      if (!VALID_ACTION_TYPES.has(at)) {
        return NextResponse.json({ error: `Invalid actionType` }, { status: 400 });
      }
      updates.action_type = at;
    }

    const stringFields: Record<string, string> = {
      partName: 'part_name',
      oldSku: 'old_sku',
      newSku: 'new_sku',
      oldSerial: 'old_serial',
      newSerial: 'new_serial',
      notes: 'notes',
    };
    for (const [bodyKey, dbKey] of Object.entries(stringFields)) {
      if (body[bodyKey] !== undefined) updates[dbKey] = normString(body[bodyKey]);
    }
    if (body.durationMin !== undefined) updates.duration_min = normInt(body.durationMin);

    const entries = Object.entries(updates);
    if (entries.length === 0) {
      return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
    }

    const setSql = entries.map(([col], i) => `${col} = $${i + 2}`).join(', ');
    const values = entries.map(([, v]) => v);

    try {
      await pool.query(
        `UPDATE repair_actions SET ${setSql} WHERE id = $1`,
        [id, ...values],
      );
      await invalidateCacheTags(['repair-service']);
      await publishRepairChanged({
        organizationId: ctx.organizationId,
        repairIds: [existing.repair_id],
        source: 'repair.action-edited',
      });
      return NextResponse.json({ success: true });
    } catch (error: any) {
      console.error('PATCH /api/repair/actions/[id] error:', error);
      return NextResponse.json(
        { error: 'Failed to update action', details: error?.message },
        { status: 500 },
      );
    }
  },
  { permission: 'repair.mark_repaired' },
);

/**
 * DELETE /api/repair/actions/[id]
 *
 * Soft delete — sets deleted_at. Author or admin only.
 */
export const DELETE = withAuth(
  async (req, ctx) => {
    const idRaw = req.nextUrl.pathname.split('/').pop() ?? '';
    const id = Number(decodeURIComponent(idRaw));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid action id' }, { status: 400 });
    }

    const existing = await loadActionForMutation(id);
    if (!existing) return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    if (!canMutate(existing, ctx.staffId, ctx.role)) {
      return NextResponse.json({ error: 'Not allowed to delete this action' }, { status: 403 });
    }

    try {
      await pool.query(
        `UPDATE repair_actions SET deleted_at = NOW() WHERE id = $1`,
        [id],
      );
      await invalidateCacheTags(['repair-service']);
      await publishRepairChanged({
        organizationId: ctx.organizationId,
        repairIds: [existing.repair_id],
        source: 'repair.action-deleted',
      });
      return NextResponse.json({ success: true });
    } catch (error: any) {
      console.error('DELETE /api/repair/actions/[id] error:', error);
      return NextResponse.json(
        { error: 'Failed to delete action', details: error?.message },
        { status: 500 },
      );
    }
  },
  { permission: 'repair.mark_repaired' },
);
