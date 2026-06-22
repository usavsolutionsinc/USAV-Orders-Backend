import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import {
  GoogleSheetsTransferOrdersJobError,
  runGoogleSheetsTransferOrders,
} from '@/lib/jobs/google-sheets-transfer-orders';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** GET /api/cron/google-sheets/transfer-orders  (Vercel cron, weekday schedule) */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const locked = await withCronLock('google_sheets.transfer_orders', () =>
      withCronRun('google_sheets.transfer_orders', () =>
        runGoogleSheetsTransferOrders(undefined, 'sheets'),
      ),
    );
    if (!locked.ran) {
      return NextResponse.json({ success: true, skipped: 'locked' });
    }
    const result = locked.result!;
    return NextResponse.json({ success: true, ...(result as unknown as Record<string, unknown>) });
  } catch (error) {
    if (error instanceof GoogleSheetsTransferOrdersJobError) {
      return NextResponse.json(error.body as Record<string, unknown>, { status: 200 });
    }
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('[cron/google-sheets/transfer-orders]', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
