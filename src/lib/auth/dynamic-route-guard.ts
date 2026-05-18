/**
 * Per-handler auth gate for routes whose signature requires Next's typed
 * `{ params }` second arg (dynamic segments like `[id]`, `[barcode]`).
 *
 * The standard `withAuth(...)` wrapper can't be used on those routes because
 * its returned signature `(req, RouteContext)` differs from Next's typed
 * version `(req, { params })` — TS rejects the assignment.
 *
 * Instead, call `requireRoutePerm(req, perm)` at the top of each handler:
 *
 *   export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
 *     const gate = await requireRoutePerm(req, 'sku_stock.adjust');
 *     if (gate.denied) return gate.denied;
 *     const ctx = gate.ctx; // staffId, role, permissions — all session-derived
 *     // … rest of handler
 *   }
 *
 * Semantics mirror `withAuth({ permission })`:
 *   - No session cookie → 401 UNAUTHENTICATED
 *   - Session exists but lacks `perm` → 403 FORBIDDEN + auth_audit row
 *   - Otherwise → returns { denied: null, ctx } with non-null actor
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import type { AuthContext } from '@/lib/auth/withAuth';
import { getCurrentUserBySid } from '@/lib/auth/current-user';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import type { PermissionString } from '@/lib/auth/permissions-shared';
import { audit } from '@/lib/auth/audit';
import { recordAudit } from '@/lib/audit-logs';

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;
  const real = req.headers.get('x-real-ip');
  return real || null;
}

export type RouteGuardResult =
  | { denied: NextResponse; ctx: null }
  | { denied: null; ctx: AuthContext };

export async function requireRoutePerm(
  req: NextRequest,
  perm: PermissionString,
): Promise<RouteGuardResult> {
  const sid = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const user = await getCurrentUserBySid(sid);

  if (!user) {
    return {
      denied: NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 }),
      ctx: null,
    };
  }

  if (!user.permissions.has(perm)) {
    await audit({
      staffId: user.staffId,
      event: 'permission.denied',
      result: 'denied',
      sid: user.session.sid,
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
      detail: { permission: perm, api: true, path: req.nextUrl.pathname },
    });
    return {
      denied: NextResponse.json(
        { error: 'FORBIDDEN', permission: perm, role: user.role },
        { status: 403 },
      ),
      ctx: null,
    };
  }

  return {
    denied: null,
    ctx: {
      user,
      session: user.session,
      staffId: user.staffId,
      role: user.role,
      permissions: user.permissions,
      // markAuditWritten is a no-op for dynamic-param routes — there's no
      // wrapper-level audit floor on this path. Call `recordRouteAudit()`
      // explicitly when the handler wants to emit an audit row.
      markAuditWritten: () => {},
    },
  };
}

/**
 * Audit-floor for dynamic-param routes. Counterpart to the `audit:` option
 * on `withAuth`. Call at the end of the handler, AFTER constructing the
 * NextResponse but BEFORE returning it:
 *
 *   const response = NextResponse.json({ … });
 *   await recordRouteAudit(req, gate.ctx, response, {
 *     source: 'receiving.line.move',
 *     action: AUDIT_ACTION.BIN_MOVE,
 *     entityType: AUDIT_ENTITY.BIN,
 *     entityId: ({ response }) => (response as any)?.line_id ?? null,
 *   });
 *   return response;
 *
 * Errors are swallowed — audit floor is best-effort.
 */
export interface RouteAuditOpts {
  source: string;
  action: string;
  entityType: string;
  entityId: (args: {
    body: unknown;
    response: unknown;
    req: NextRequest;
  }) => string | number | null;
  extra?: (args: { body: unknown; response: unknown }) => Record<string, unknown>;
}

async function tryReadJson(input: Request | Response | null): Promise<unknown> {
  if (!input) return null;
  try {
    const text = await input.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function recordRouteAudit(
  req: NextRequest,
  ctx: AuthContext,
  response: Response,
  opts: RouteAuditOpts,
): Promise<void> {
  if (response.status < 200 || response.status >= 300) return;
  try {
    const [body, parsedResponse] = await Promise.all([
      tryReadJson(req.clone()),
      tryReadJson(response.clone()),
    ]);
    const entityId = opts.entityId({ body, response: parsedResponse, req });
    if (entityId == null || entityId === '') return;
    await recordAudit(pool, ctx, req, {
      source: opts.source,
      action: opts.action,
      entityType: opts.entityType,
      entityId,
      method: 'system',
      extra: opts.extra ? opts.extra({ body, response: parsedResponse }) : undefined,
    });
  } catch (err) {
    console.warn(
      '[recordRouteAudit] write failed:',
      err instanceof Error ? err.message : err,
    );
  }
}
