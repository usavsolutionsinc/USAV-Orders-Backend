import { NextRequest, NextResponse } from 'next/server';
import { runEbayRefreshTokensJob } from '@/lib/jobs/ebay-refresh-tokens';
import { logRouteMetric } from '@/lib/route-metrics';
import { withAuth } from '@/lib/auth/withAuth';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { USAV_ORG_ID } from '@/lib/tenancy/constants';

/**
 * POST /api/ebay/refresh-tokens
 * Worker endpoint: refreshes all eBay accounts whose token expires within 30 minutes.
 * Intended for internal calls and the /api/cron/ebay/refresh-tokens scheduled worker.
 */
export const dynamic = 'force-dynamic';

export const maxDuration = 60;

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const startedAt = Date.now();
  let ok = false;
  // This is a CROSS-ORG worker (refreshes every tenant's eBay tokens), so it must
  // not be triggerable by an arbitrary per-org caller that merely holds the
  // integrations.ebay permission. Gate it to a cron/service identity: either an
  // authorized cron request (CRON_SECRET / x-vercel-cron) or the dogfood service
  // org (USAV). Single-tenant USAV behavior is unchanged — its session IS the
  // service org, so the manual trigger keeps working.
  if (!isAuthorizedCronRequest(req.headers) && ctx.organizationId !== USAV_ORG_ID) {
    return NextResponse.json(
      { success: false, error: 'Forbidden: cross-org worker is restricted to the service identity.' },
      { status: 403 }
    );
  }
  try {
    const result = await runEbayRefreshTokensJob();
    ok = true;
    // Strip cross-org account_name values that the job collects in errors[]; a
    // per-org caller must never see other tenants' account names. Return only
    // counts (message/refreshed/total/needsReconsent are name-free).
    const { errors, ...safe } = result;
    return NextResponse.json({ ...safe, errorCount: errors?.length ?? 0 });
  } catch (error: any) {
    console.error('[ebay/refresh-tokens]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 }
    );
  } finally {
    logRouteMetric({
      route: '/api/ebay/refresh-tokens',
      method: 'POST',
      startedAt,
      ok,
    });
  }
}, { permission: 'integrations.ebay' });

export const GET = withAuth(async () => {
  return NextResponse.json(
    { success: false, error: 'Method not allowed. Use POST (cron worker route).' },
    { status: 405 }
  );
}, { permission: 'integrations.ebay' });
