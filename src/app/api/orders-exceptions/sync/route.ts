import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { invalidateAllOrdersApiCaches } from '@/lib/orders/invalidation';
import { syncOrderExceptionsToOrders } from '@/lib/orders-exceptions';
import { formatPSTTimestamp } from '@/utils/date';
import { createNdjsonStream, ndjsonResponseHeaders } from '@/lib/orders-sync/streaming';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isTrustedAppOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin') || '';
  const referer = request.headers.get('referer') || '';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';

  const candidates = [origin, referer].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.host === host) return true;
    } catch {
      // ignore invalid origin/referer
    }
  }

  return false;
}

// Session + permission gate (the origin check alone is spoofable — it was the
// only guard when this route first shipped, kept as a CSRF belt). orders.view
// mirrors the receiving refresh/stream sibling: any staff who works the
// orders surfaces may trigger the sync; anonymous calls 401.
export const POST = withAuth(async (request: NextRequest, ctx) => {
  if (!isTrustedAppOrigin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stream = createNdjsonStream();
  (async () => {
    try {
      const result = await syncOrderExceptionsToOrders(stream.emit);
      if (result.matched > 0) {
        await invalidateAllOrdersApiCaches();
      }
      // The sweep writes orders + orders_exceptions rows — record who pulled
      // the trigger and what landed (the stream result isn't otherwise kept).
      await recordAudit(pool, ctx, request, {
        source: 'orders-exceptions-api',
        action: AUDIT_ACTION.ORDERS_EXCEPTIONS_SYNC,
        entityType: AUDIT_ENTITY.ORDER,
        entityId: 'orders_exceptions_sweep',
        extra: { ...result },
      });
      stream.emit({
        type: 'result',
        result: {
          success: true,
          ...result,
          timestamp: formatPSTTimestamp(),
        },
      });
    } catch (error) {
      console.error(
        'Error syncing orders_exceptions:',
        error instanceof Error ? error.message : String(error),
      );
      stream.emit({
        type: 'error',
        error: error instanceof Error ? error.message : 'Failed to sync orders_exceptions',
      });
    } finally {
      stream.finish();
    }
  })();

  return new Response(stream.body, { headers: ndjsonResponseHeaders() });
}, { permission: 'orders.view' });
