/**
 * GET  /api/admin/roles  — list every role with member count
 * POST /api/admin/roles  — create a new (non-system) role
 *
 * Body for POST: { key, label, color?, position?, permissions?: string[] }
 *
 * Both endpoints are gated by `admin.manage_roles`. After a create, the
 * server-side role cache is invalidated so the change shows up on the next
 * permission resolve.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { audit } from '@/lib/auth/audit';
import { invalidateRoleCache } from '@/lib/auth/role-store';
import { ALL_PERMISSIONS } from '@/lib/auth/permissions-shared';

export const runtime = 'nodejs';

const KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

function sanitizePermissions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (!t) continue;
    if (!ALL_PERMISSIONS.has(t as never)) continue; // forward-compat: drop unknowns
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export const GET = withAuth(async () => {
  const r = await pool.query(
    `SELECT r.id, r.key, r.label, r.color, r.position, r.permissions, r.is_system,
            r.created_at, r.updated_at,
            COALESCE(c.cnt, 0)::INT AS member_count
       FROM roles r
       LEFT JOIN (
         SELECT role_id, COUNT(*)::INT AS cnt FROM staff_roles GROUP BY role_id
       ) c ON c.role_id = r.id
      ORDER BY r.position ASC, r.id ASC`,
  );
  return NextResponse.json({ roles: r.rows });
}, { permission: 'admin.manage_roles' });

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const key = String((body as { key?: unknown }).key ?? '').trim().toLowerCase();
  const label = String((body as { label?: unknown }).label ?? '').trim();
  const color = String((body as { color?: unknown }).color ?? '#6b7280').trim();
  const positionRaw = (body as { position?: unknown }).position;
  const permissions = sanitizePermissions((body as { permissions?: unknown }).permissions);

  if (!KEY_RE.test(key)) {
    return NextResponse.json({ error: 'INVALID_KEY', message: 'Use lowercase letters, digits, and underscores; start with a letter.' }, { status: 400 });
  }
  if (!label) return NextResponse.json({ error: 'INVALID_LABEL' }, { status: 400 });
  if (!HEX_RE.test(color)) return NextResponse.json({ error: 'INVALID_COLOR' }, { status: 400 });

  const position = Number.isFinite(Number(positionRaw)) ? Math.max(0, Math.floor(Number(positionRaw))) : 500;

  try {
    const r = await pool.query(
      `INSERT INTO roles (key, label, color, position, permissions, is_system)
       VALUES ($1, $2, $3, $4, $5::TEXT[], FALSE)
       RETURNING id, key, label, color, position, permissions, is_system, created_at, updated_at`,
      [key, label, color, position, permissions],
    );
    const created = r.rows[0];
    invalidateRoleCache();
    await audit({
      staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
      event: 'role.created', result: 'ok',
      detail: { roleId: created.id, key, label, position, permissionCount: permissions.length },
    });
    return NextResponse.json({ role: created });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      return NextResponse.json({ error: 'KEY_TAKEN' }, { status: 409 });
    }
    throw err;
  }
}, { permission: 'admin.manage_roles' });
