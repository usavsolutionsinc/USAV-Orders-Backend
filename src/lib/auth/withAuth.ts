/**
 * API route wrapper.
 *
 *   export const POST = withAuth(async (req, ctx) => { ... }, {
 *     permission: 'receiving.mark_received',
 *     stepUp: true, // optional: also requires a fresh step-up grant
 *   });
 *
 * The handler receives `{ session, staffId, role, permissions }` so it can
 * stop reading `staffId` from the request body — that path was trust-the-
 * client by design and the new wrapper closes it.
 *
 * While AUTH_V2_ENABLED is off, unauthenticated callers fall through with
 * `ctx.session = null` so existing routes keep working during phased
 * rollout. Routes that opt in by passing `{ enforce: true }` always enforce.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserBySid, type CurrentUser } from './current-user';
import { SESSION_COOKIE_NAME } from './session';
import { hasStepUp } from './stepup';
import { requiresStepUp, type PermissionString } from './permissions';
import { audit } from './audit';

export interface AuthContext {
  user: CurrentUser | null;
  // Convenience pass-throughs (null when user is null and we aren't enforcing)
  session: CurrentUser['session'] | null;
  staffId: number | null;
  role: CurrentUser['role'] | null;
  permissions: CurrentUser['permissions'];
}

export interface WithAuthOpts {
  permission?: PermissionString;
  stepUp?: boolean;
  /** Force enforcement regardless of AUTH_V2_ENABLED. */
  enforce?: boolean;
  /** Allow unauthenticated calls (for /api/auth/signin itself, /api/health, etc). */
  allowAnonymous?: boolean;
}

type ApiHandler = (req: NextRequest, ctx: AuthContext) => Promise<Response> | Response;
// Match Next's RouteHandlerConfig — second arg is a route context with
// `params` as a Promise. We ignore it in the wrapper; downstream handlers
// that need [id]-style params parse `req.nextUrl.pathname` instead.
type RouteContext = { params: Promise<Record<string, string | string[] | undefined>> };
type RouteHandler = (req: NextRequest, ctx: RouteContext) => Promise<Response> | Response;

function isAuthV2Enabled(): boolean {
  return process.env.AUTH_V2_ENABLED === 'true' || process.env.AUTH_V2_ENABLED === '1';
}

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;
  const real = req.headers.get('x-real-ip');
  return real || null;
}

export function withAuth(handler: ApiHandler, opts: WithAuthOpts = {}): RouteHandler {
  return async (req, _routeCtx) => {
    const enforce = opts.enforce ?? isAuthV2Enabled();
    const sid = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
    const user = await getCurrentUserBySid(sid);

    if (!user && !opts.allowAnonymous) {
      if (enforce) {
        return NextResponse.json(
          { error: 'UNAUTHENTICATED' },
          { status: 401 },
        );
      }
      // Shadow mode: fall through with empty context. Existing routes that
      // still read body.staffId continue to work until they're refactored.
    }

    if (user && opts.permission && !user.permissions.has(opts.permission)) {
      await audit({
        staffId: user.staffId,
        event: 'permission.denied',
        result: 'denied',
        sid: user.session.sid,
        ip: clientIp(req),
        userAgent: req.headers.get('user-agent'),
        detail: { permission: opts.permission, api: true, path: req.nextUrl.pathname },
      });
      if (enforce) {
        return NextResponse.json(
          { error: 'FORBIDDEN', permission: opts.permission, role: user.role },
          { status: 403 },
        );
      }
    }

    const needsStepUp = opts.stepUp || (opts.permission ? requiresStepUp(opts.permission) : false);
    if (user && needsStepUp) {
      const scope = opts.permission ?? 'destructive';
      const granted = await hasStepUp(user.session.sid, scope);
      if (!granted) {
        if (enforce) {
          return NextResponse.json(
            { error: 'STEPUP_REQUIRED', scope, method_hint: 'pin' },
            { status: 403 },
          );
        }
      }
    }

    const ctx: AuthContext = user
      ? {
          user,
          session: user.session,
          staffId: user.staffId,
          role: user.role,
          permissions: user.permissions,
        }
      : {
          user: null,
          session: null,
          staffId: null,
          role: null,
          permissions: new Set(),
        };

    return handler(req, ctx);
  };
}
