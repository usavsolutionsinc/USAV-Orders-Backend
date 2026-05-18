/**
 * API route wrapper.
 *
 *   export const POST = withAuth(async (req, ctx) => { ... }, {
 *     permission: 'receiving.mark_received',
 *     stepUp: true, // optional: also requires a fresh step-up grant
 *   });
 *
 * The handler receives `{ session, staffId, role, permissions }` from the
 * verified session cookie — it does NOT trust `staffId` from the request
 * body.
 *
 * Enforcement is unconditional: every wrapped route requires a valid
 * session unless `allowAnonymous: true` is passed (for `/api/auth/signin`,
 * `/api/health`, webhook receivers with their own signature gate, etc).
 *
 * When `allowAnonymous: true`, `ctx.user` may be `null`; in every other
 * call site the handler sees a `staffId: number` (non-null).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserBySid, type CurrentUser } from './current-user';
import { SESSION_COOKIE_NAME } from './session';
import { hasStepUp } from './stepup';
import { requiresStepUp, type PermissionString } from './permissions';
import { audit } from './audit';
import pool from '@/lib/db';
import { recordAudit } from '@/lib/audit-logs';

/**
 * Auth context handed to wrapped route handlers.
 *
 * `AuthContext` (the default) is what authenticated routes see — every field
 * is non-null. `AnonymousAuthContext` is what `allowAnonymous: true` routes
 * see; they must null-check `user` themselves.
 */
export interface AuthContext {
  user: CurrentUser;
  session: CurrentUser['session'];
  staffId: number;
  role: CurrentUser['role'];
  permissions: CurrentUser['permissions'];
  /**
   * Call this when the handler writes its own rich `audit_logs` row (with
   * before/after diffs). The wrapper-level `audit:` floor will skip so we
   * don't double-write. No-op when the wrapper has no `audit:` configured.
   */
  markAuditWritten: () => void;
}

export interface AnonymousAuthContext {
  user: CurrentUser | null;
  session: CurrentUser['session'] | null;
  staffId: number | null;
  role: CurrentUser['role'] | null;
  permissions: CurrentUser['permissions'];
  markAuditWritten: () => void;
}

/**
 * Audit-floor config. When set on a route, the wrapper writes one
 * `audit_logs` row per 2xx response. Handlers that need rich
 * before/after diffs should call `ctx.markAuditWritten()` and write their
 * own row via `recordAudit(...)` directly — that path is unaffected.
 *
 * `entityId` is a function so the handler can pull the id from either the
 * parsed request body or the response payload — whichever the route's
 * shape makes natural. Return `null` to skip the audit write for that
 * call (e.g. when a 200 is actually a "no-op" branch).
 */
export interface WithAuthAuditOpts {
  source: string;
  action: string;
  entityType: string;
  entityId: (args: {
    body: unknown;
    response: unknown;
    req: NextRequest;
  }) => string | number | null;
  /** Extra metadata merged into the audit row. Optional. */
  extra?: (args: { body: unknown; response: unknown }) => Record<string, unknown>;
}

export interface WithAuthOpts {
  permission?: PermissionString;
  stepUp?: boolean;
  /** Allow unauthenticated calls (for /api/auth/signin itself, /api/health, webhook routes with their own signature gate, etc). */
  allowAnonymous?: boolean;
  /** Write a baseline `audit_logs` row on 2xx. Handler can opt out via `ctx.markAuditWritten()`. */
  audit?: WithAuthAuditOpts;
}

type ApiHandler = (req: NextRequest, ctx: AuthContext) => Promise<Response> | Response;
type AnonymousApiHandler = (req: NextRequest, ctx: AnonymousAuthContext) => Promise<Response> | Response;
// Match Next's RouteHandlerConfig — second arg is a route context with
// `params` as a Promise. We ignore it in the wrapper; downstream handlers
// that need [id]-style params parse `req.nextUrl.pathname` instead.
type RouteContext = { params: Promise<Record<string, string | string[] | undefined>> };
type RouteHandler = (req: NextRequest, ctx: RouteContext) => Promise<Response> | Response;

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;
  const real = req.headers.get('x-real-ip');
  return real || null;
}

/**
 * Best-effort JSON parse of a cloned request/response. Returns null on
 * empty body or parse error — callers always handle null.
 */
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

/**
 * Write a baseline audit row after a wrapped handler resolves with 2xx.
 * Errors are swallowed — audit must never break the request response.
 */
async function writeAuditFloor(
  req: NextRequest,
  responseClone: Response,
  ctx: AuthContext | AnonymousAuthContext,
  audit: WithAuthAuditOpts,
): Promise<void> {
  try {
    // The wrapper holds clones of both streams so the handler's reads aren't
    // disturbed. Either parse may legitimately fail (e.g. empty 204, or a
    // non-JSON body) — entityId() should tolerate null/undefined inputs.
    const [body, response] = await Promise.all([
      tryReadJson(req.clone()),
      tryReadJson(responseClone),
    ]);

    const entityId = audit.entityId({ body, response, req });
    if (entityId == null || entityId === '') return;

    await recordAudit(pool, ctx, req, {
      source: audit.source,
      action: audit.action,
      entityType: audit.entityType,
      entityId,
      method: 'system',
      extra: audit.extra ? audit.extra({ body, response }) : undefined,
    });
  } catch (err) {
    // Don't propagate — audit floor is best-effort.
    console.warn(
      '[withAuth.audit] floor write failed:',
      err instanceof Error ? err.message : err,
    );
  }
}

// Overloads so TS narrows `ctx` based on `allowAnonymous`. Authenticated
// routes get `AuthContext` (staffId: number); anonymous-permitted routes get
// `AnonymousAuthContext` (staffId: number | null) and must null-check user.
export function withAuth(
  handler: AnonymousApiHandler,
  opts: WithAuthOpts & { allowAnonymous: true },
): RouteHandler;
export function withAuth(handler: ApiHandler, opts?: WithAuthOpts): RouteHandler;
export function withAuth(
  handler: ApiHandler | AnonymousApiHandler,
  opts: WithAuthOpts = {},
): RouteHandler {
  return async (req, _routeCtx) => {
    const sid = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
    const user = await getCurrentUserBySid(sid);

    // Hidden flag toggled by `ctx.markAuditWritten()`. We don't put it on
    // the ctx itself because it shouldn't be observable by handlers.
    let auditWritten = false;
    const markAuditWritten = () => { auditWritten = true; };

    if (!user) {
      if (!opts.allowAnonymous) {
        return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
      }
      // Anonymous route: hand the handler an empty context.
      const ctx: AnonymousAuthContext = {
        user: null,
        session: null,
        staffId: null,
        role: null,
        permissions: new Set(),
        markAuditWritten,
      };
      return (handler as AnonymousApiHandler)(req, ctx);
    }

    if (opts.permission && !user.permissions.has(opts.permission)) {
      await audit({
        staffId: user.staffId,
        event: 'permission.denied',
        result: 'denied',
        sid: user.session.sid,
        ip: clientIp(req),
        userAgent: req.headers.get('user-agent'),
        detail: { permission: opts.permission, api: true, path: req.nextUrl.pathname },
      });
      return NextResponse.json(
        { error: 'FORBIDDEN', permission: opts.permission, role: user.role },
        { status: 403 },
      );
    }

    const needsStepUp = opts.stepUp || (opts.permission ? requiresStepUp(opts.permission) : false);
    if (needsStepUp) {
      const scope = opts.permission ?? 'destructive';
      const granted = await hasStepUp(user.session.sid, scope);
      if (!granted) {
        return NextResponse.json(
          { error: 'STEPUP_REQUIRED', scope, method_hint: 'pin' },
          { status: 403 },
        );
      }
    }

    const ctx: AuthContext = {
      user,
      session: user.session,
      staffId: user.staffId,
      role: user.role,
      permissions: user.permissions,
      markAuditWritten,
    };

    const response = opts.allowAnonymous
      ? await (handler as AnonymousApiHandler)(req, ctx)
      : await (handler as ApiHandler)(req, ctx);

    // Audit floor: only on 2xx and when the handler didn't write its own
    // rich row. Fire-and-forget — the response is already prepared so audit
    // latency doesn't extend the client's wait.
    if (
      opts.audit &&
      !auditWritten &&
      response.status >= 200 &&
      response.status < 300
    ) {
      const responseClone = response.clone();
      void writeAuditFloor(req, responseClone, ctx, opts.audit);
    }

    return response;
  };
}
