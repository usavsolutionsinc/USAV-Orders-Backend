/**
 * POST /api/log-error
 *
 * Client-side error reporting sink. Lightweight on purpose — the browser
 * POSTs `{ message, stack, url, userAgent, extra? }` and we emit one
 * structured log line server-side. From there it flows to whatever log
 * collector the platform uses.
 *
 * Anonymous-friendly: signed-out pages (signin, signup, /m/enroll) need
 * to be able to report errors too. We do attribute the orgId/staffId
 * when a session is present.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/withAuth';
import { checkRateLimitAsync } from '@/lib/api-guard';
import { logger } from '@/lib/observability/logger';
import { captureError } from '@/lib/observability/errors';

const Body = z.object({
  message: z.string().max(1024),
  stack: z.string().max(8192).optional(),
  url: z.string().max(2048).optional(),
  userAgent: z.string().max(512).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const POST = withAuth(async (req, ctx) => {
  // Throttle to stop a runaway client loop from filling logs.
  const rl = await checkRateLimitAsync({
    headers: req.headers,
    routeKey: 'log-error',
    limit: 60,
    windowMs: 60_000,
    scope: ctx.staffId ?? null,
  });
  if (!rl.ok) {
    return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  }

  logger.error(
    {
      source: 'client',
      orgId: ctx.organizationId,
      staffId: ctx.staffId,
      stack: parsed.stack,
      url: parsed.url,
      userAgent: parsed.userAgent,
      extra: parsed.extra,
    },
    parsed.message,
  );

  // Synthesize an Error to carry the client stack through to Sentry. The
  // logger has already recorded a structured line locally — captureError
  // just adds the off-instance forwarding when SENTRY_DSN is configured.
  const synthetic = Object.assign(new Error(parsed.message), { stack: parsed.stack });
  captureError(synthetic, {
    orgId: ctx.organizationId,
    staffId: ctx.staffId ?? undefined,
    route: parsed.url,
    source: 'client',
    userAgent: parsed.userAgent,
    ...parsed.extra,
  });

  return NextResponse.json({ status: 'ok' });
}, { allowAnonymous: true });
