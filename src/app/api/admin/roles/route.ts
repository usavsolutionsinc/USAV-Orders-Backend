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
import { withAuth } from '@/lib/auth/withAuth';
import { audit } from '@/lib/auth/audit';
import { invalidateRoleCache } from '@/lib/auth/role-store';
import { ALL_PERMISSIONS } from '@/lib/auth/permissions-shared';
import { tenantQuery } from '@/lib/tenancy/db';

export const runtime = 'nodejs';

const KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * Returns the deduped, valid subset and the list of unknown strings.
 * Callers decide whether to reject (PATCH/POST should) or to drop silently
 * (no current call site should — the silent-drop pattern caused real bugs).
 */
function partitionPermissions(raw: unknown): { valid: string[]; unknown: string[] } {
  if (!Array.isArray(raw)) return { valid: [], unknown: [] };
  const seen = new Set<string>();
  const valid: string[] = [];
  const unknown: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (!t) continue;
    if (!ALL_PERMISSIONS.has(t as never)) { unknown.push(t); continue; }
    if (seen.has(t)) continue;
    seen.add(t);
    valid.push(t);
  }
  return { valid, unknown };
}

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  // `roles` is a GLOBAL system table (no organization_id) — it is not org-scoped.
  // Member counts, however, MUST only count staff in THIS org: staff_roles is a
  // global junction, so we scope through the org-owned `staff` parent.
  const r = await tenantQuery(
    ctx.organizationId,
    `SELECT r.id, r.key, r.label, r.color, r.position, r.permissions, r.is_system,
            r.created_at, r.updated_at,
            COALESCE(c.cnt, 0)::INT AS member_count
       FROM roles r
       LEFT JOIN (
         SELECT sr.role_id, COUNT(*)::INT AS cnt
           FROM staff_roles sr
           JOIN staff s ON s.id = sr.staff_id
          WHERE s.organization_id = $1
          GROUP BY sr.role_id
       ) c ON c.role_id = r.id
      ORDER BY r.position ASC, r.id ASC`,
    [ctx.organizationId],
  );
  return NextResponse.json({ roles: r.rows });
}, { permission: 'admin.manage_roles' });

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const key = String((body as { key?: unknown }).key ?? '').trim().toLowerCase();
  const label = String((body as { label?: unknown }).label ?? '').trim();
  const color = String((body as { color?: unknown }).color ?? '#6b7280').trim();
  const positionRaw = (body as { position?: unknown }).position;
  const { valid: permissions, unknown: unknownPerms } = partitionPermissions(
    (body as { permissions?: unknown }).permissions,
  );

  if (!KEY_RE.test(key)) {
    return NextResponse.json({ error: 'INVALID_KEY', message: 'Use lowercase letters, digits, and underscores; start with a letter.' }, { status: 400 });
  }
  if (!label) return NextResponse.json({ error: 'INVALID_LABEL' }, { status: 400 });
  if (!HEX_RE.test(color)) return NextResponse.json({ error: 'INVALID_COLOR' }, { status: 400 });
  if (unknownPerms.length > 0) {
    return NextResponse.json(
      { error: 'UNKNOWN_PERMISSIONS', unknown: unknownPerms, message: `Rejected: ${unknownPerms.length} permission(s) not registered.` },
      { status: 400 },
    );
  }

  const position = Number.isFinite(Number(positionRaw)) ? Math.max(0, Math.floor(Number(positionRaw))) : 500;

  try {
    // `roles` is a GLOBAL system table (no organization_id) — do NOT stamp an
    // org on the row. Routed through the tenant connection only for GUC parity.
    const r = await tenantQuery(
      ctx.organizationId,
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
