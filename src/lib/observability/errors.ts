/**
 * Sentry-shaped error reporter.
 *
 * Forwards captured errors to Sentry via the public envelope endpoint
 * (`/api/<project_id>/envelope/`) when SENTRY_DSN is set. We skip the
 * Sentry SDK on purpose — the SDK pulls in ~1 MB of dependencies and we
 * use a single ingest endpoint. The envelope format is documented and
 * stable, so doing it by hand here costs nothing and avoids the install
 * footprint.
 *
 * If SENTRY_DSN isn't set, captureError() is a no-op (the structured
 * logger still records the error). Either way the caller sees the same
 * shape — drop-in replacement.
 *
 * Usage:
 *   import { captureError } from '@/lib/observability/errors';
 *   try { ... } catch (err) {
 *     captureError(err, { orgId, route: req.nextUrl.pathname });
 *   }
 */

import { logger } from './logger';

interface DsnParts {
  publicKey: string;
  host: string;
  projectId: string;
  scheme: string;
}

function parseDsn(): DsnParts | null {
  const raw = process.env.SENTRY_DSN;
  if (!raw) return null;
  // Format: scheme://publicKey@host/projectId
  const m = /^(https?):\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(raw.trim());
  if (!m) {
    console.warn('[errors] SENTRY_DSN is set but malformed; ignoring.');
    return null;
  }
  return { scheme: m[1]!, publicKey: m[2]!, host: m[3]!, projectId: m[4]! };
}

const DSN = parseDsn();
const ENV = process.env.NODE_ENV || 'development';
const RELEASE = process.env.APP_VERSION || process.env.VERCEL_GIT_COMMIT_SHA;

interface ErrorContext {
  orgId?: string | null;
  staffId?: number | null;
  route?: string;
  requestId?: string;
  /** Anything else worth attaching as tags/extras. */
  [key: string]: unknown;
}

function toException(err: unknown): { type: string; value: string; stacktrace?: { frames: Array<{ filename: string; lineno?: number; colno?: number; function?: string }> } } {
  if (err instanceof Error) {
    const frames = (err.stack || '').split('\n').slice(1).map((line) => {
      const match = /at (.+?) \(?(.+?):(\d+):(\d+)\)?/.exec(line.trim());
      if (match) {
        return { function: match[1]!, filename: match[2]!, lineno: Number(match[3]), colno: Number(match[4]) };
      }
      return { filename: line.trim() };
    });
    return { type: err.name, value: err.message, stacktrace: { frames: frames.reverse() } };
  }
  return { type: 'NonError', value: String(err) };
}

export function captureError(err: unknown, ctx: ErrorContext = {}): void {
  // Always log locally so devs see it even when Sentry is off.
  logger.error(
    { source: 'captureError', ...ctx, errMessage: err instanceof Error ? err.message : String(err) },
    'captured error',
  );

  if (!DSN) return;

  const eventId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? (crypto as { randomUUID: () => string }).randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    server_name: 'usav-orders',
    level: 'error',
    environment: ENV,
    release: RELEASE,
    tags: {
      ...(ctx.orgId ? { orgId: String(ctx.orgId) } : {}),
      ...(ctx.staffId ? { staffId: String(ctx.staffId) } : {}),
      ...(ctx.route ? { route: ctx.route } : {}),
    },
    extra: ctx,
    request: ctx.requestId ? { headers: { 'x-request-id': ctx.requestId } } : undefined,
    exception: { values: [toException(err)] },
  };

  const envelope = [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), sdk: { name: 'usav-orders.inhouse', version: '0.1.0' } }),
    JSON.stringify({ type: 'event', content_type: 'application/json' }),
    JSON.stringify(event),
  ].join('\n');

  const url = `${DSN.scheme}://${DSN.host}/api/${DSN.projectId}/envelope/?sentry_key=${DSN.publicKey}&sentry_version=7`;

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-sentry-envelope' },
    body: envelope,
  }).catch((sendErr) => {
    // Don't loop — log locally and drop.
    console.warn('[errors] sentry forward failed:', sendErr instanceof Error ? sendErr.message : sendErr);
  });
}
