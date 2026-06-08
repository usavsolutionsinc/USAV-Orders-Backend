/**
 * Cron auth + base-URL helpers.
 *
 * Lifted out of the old src/lib/qstash.ts when QStash was removed. Every cron
 * route guards with {@link isAuthorizedCronRequest}; Vercel injects
 * `Authorization: Bearer ${CRON_SECRET}` (and `x-vercel-cron: 1`) on each
 * scheduled invocation.
 */

/**
 * Resolve the app's public base URL (no trailing slash). Used by jobs that
 * need to build absolute URLs (callbacks, self-referential fetches).
 */
export function getAppBaseUrl(): string {
  const explicit =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');

  const normalized = String(explicit || '').trim().replace(/\/$/, '');
  if (!normalized) {
    throw new Error('APP_URL, NEXT_PUBLIC_APP_URL, or VERCEL_URL is required');
  }
  return normalized;
}

/**
 * Vercel cron requests carry `Authorization: Bearer ${CRON_SECRET}` and an
 * `x-vercel-cron: 1` header. Either signal is sufficient.
 *
 * NOTE: an empty/unset CRON_SECRET makes the Bearer path fail closed — set it
 * in the Vercel project env and redeploy (env changes only apply on redeploy).
 */
export function isVercelCronOrigin(headers: Headers): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret && headers.get('authorization') === `Bearer ${secret}`) return true;
  if (headers.get('x-vercel-cron') === '1' && process.env.VERCEL === '1') return true;
  return false;
}

/**
 * True if a request is an authorized cron trigger. Kept as a distinct name from
 * {@link isVercelCronOrigin} so call sites read intent-first and so a future
 * additional trigger source has one place to land.
 */
export function isAuthorizedCronRequest(headers: Headers): boolean {
  return isVercelCronOrigin(headers);
}
