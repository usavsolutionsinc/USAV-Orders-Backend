import { NextRequest, NextResponse } from 'next/server';
import {
  GoogleSheetsTransferOrdersJobError,
  runGoogleSheetsTransferOrders,
} from '@/lib/jobs/google-sheets-transfer-orders';
import { logRouteMetric } from '@/lib/route-metrics';
import { withAuth } from '@/lib/auth/withAuth';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (req: NextRequest) => {
  const startedAt = Date.now();
  let ok = false;

  try {
    const result = await runGoogleSheetsTransferOrders(undefined, 'ecwid');

    ok = true;
    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof GoogleSheetsTransferOrdersJobError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal Server Error' },
      { status: 500 },
    );
  } finally {
    logRouteMetric({
      route: '/api/ecwid/transfer-orders',
      method: 'POST',
      startedAt,
      ok,
      details: {},
    });
  }
}, { permission: 'integrations.ecwid' });
