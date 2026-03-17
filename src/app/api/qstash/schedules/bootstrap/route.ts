import { NextRequest, NextResponse } from 'next/server';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';
import { upsertQStashSchedule } from '@/lib/qstash';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  if (isAllowedAdminOrigin(req)) return true;

  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${secret}`) return true;

  return req.headers.get('x-cron-secret') === secret;
}

const HEAVY_JOB_SCHEDULES = [
  {
    scheduleId: 'google-sheets-transfer-orders-0830-pacific',
    cron: '30 16 * * *',
    path: '/api/google-sheets/transfer-orders',
    body: {},
    label: 'google-sheets-transfer-orders',
  },
  {
    scheduleId: 'google-sheets-transfer-orders-1000-weekdays-pacific',
    cron: '0 18 * * 1-5',
    path: '/api/google-sheets/transfer-orders',
    body: {},
    label: 'google-sheets-transfer-orders',
  },
  {
    scheduleId: 'google-sheets-transfer-orders-1600-weekdays-pacific',
    cron: '0 0 * * 2-6',
    path: '/api/google-sheets/transfer-orders',
    body: {},
    label: 'google-sheets-transfer-orders',
  },
  {
    scheduleId: 'ebay-sync-exceptions-quarter-hour',
    cron: '10,25,40,55 * * * *',
    path: '/api/qstash/ebay/sync',
    body: { reconcileExceptions: true },
    label: 'ebay-sync',
  },
  {
    scheduleId: 'zoho-purchase-orders-half-hour',
    cron: '20,50 * * * *',
    path: '/api/zoho/purchase-orders/sync',
    body: { days_back: 2, per_page: 200, max_pages: 20, max_items: 2000 },
    label: 'zoho-purchase-orders-sync',
  },
  {
    scheduleId: 'zoho-purchase-receives-half-hour',
    cron: '25,55 * * * *',
    path: '/api/zoho/purchase-receives/sync',
    body: { per_page: 100, max_pages: 10, max_items: 1000 },
    label: 'zoho-purchase-receives-sync',
  },
  {
    scheduleId: 'orders-exceptions-sync-half-hour',
    cron: '35,5 * * * *',
    path: '/api/orders-exceptions/sync',
    body: {},
    label: 'orders-exceptions-sync',
  },
] as Array<{
  scheduleId: string;
  cron: string;
  path: string;
  body: Record<string, unknown>;
  label: string;
}>;

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const results = await Promise.all(
      HEAVY_JOB_SCHEDULES.map(async (schedule) => {
        const result = await upsertQStashSchedule(schedule);
        return { ...schedule, ...result };
      })
    );

    return NextResponse.json({
      success: true,
      schedules: results,
      count: results.length,
    });
  } catch (error: any) {
    console.error('[qstash/schedules/bootstrap]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to bootstrap schedules' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
