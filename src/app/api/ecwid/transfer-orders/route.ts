import { NextRequest } from 'next/server';
import {
  GoogleSheetsTransferOrdersJobError,
  runGoogleSheetsTransferOrders,
} from '@/lib/jobs/google-sheets-transfer-orders';
import { logRouteMetric } from '@/lib/route-metrics';
import { withAuth } from '@/lib/auth/withAuth';
import { createNdjsonStream, ndjsonResponseHeaders } from '@/lib/orders-sync/streaming';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (_req: NextRequest) => {
  const startedAt = Date.now();
  let ok = false;

  const stream = createNdjsonStream();
  (async () => {
    try {
      const result = await runGoogleSheetsTransferOrders(undefined, 'ecwid', stream.emit);
      stream.emit({ type: 'result', result: result as unknown as Record<string, unknown> });
      ok = true;
    } catch (error: any) {
      if (error instanceof GoogleSheetsTransferOrdersJobError) {
        stream.emit({ type: 'result', result: error.body as Record<string, unknown> });
      } else {
        stream.emit({ type: 'error', error: error?.message || 'Internal Server Error' });
      }
    } finally {
      stream.finish();
      logRouteMetric({
        route: '/api/ecwid/transfer-orders',
        method: 'POST',
        startedAt,
        ok,
        details: {},
      });
    }
  })();

  return new Response(stream.body, { headers: ndjsonResponseHeaders() });
}, { permission: 'orders.import' });
