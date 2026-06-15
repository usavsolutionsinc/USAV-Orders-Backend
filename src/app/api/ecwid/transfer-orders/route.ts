import { NextRequest } from 'next/server';
import {
  GoogleSheetsTransferOrdersJobError,
  runGoogleSheetsTransferOrders,
} from '@/lib/jobs/google-sheets-transfer-orders';
import { logRouteMetric } from '@/lib/route-metrics';
import { withAuth } from '@/lib/auth/withAuth';
import { createNdjsonStream, ndjsonResponseHeaders } from '@/lib/orders-sync/streaming';
import { transitionalUsavOrgId } from '@/lib/tenancy/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (_req: NextRequest) => {
  const startedAt = Date.now();
  let ok = false;

  // TRANSITIONAL: this Ecwid transfer endpoint backs a Vercel cron that has no
  // session, so there is no ctx.organizationId. Single-tenant (USAV) today;
  // resolve the service org and pass it into the shared sync job so all its
  // tenant-table reads/writes run GUC-scoped (app.current_org) + stamp org.
  // TODO(multi-tenant): resolve org from the per-connection / Ecwid-account
  // mapping instead of the USAV service org.
  // (no-restricted-syntax tenancy guard turned off for this file via the
  // burn-down allowlist in eslint.config.mjs — delete that entry when refactored.)
  const orgId = transitionalUsavOrgId();

  const stream = createNdjsonStream();
  (async () => {
    try {
      const result = await runGoogleSheetsTransferOrders(undefined, 'ecwid', stream.emit, orgId);
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
