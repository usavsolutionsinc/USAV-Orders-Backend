import { NextRequest, NextResponse } from 'next/server';
import { isQStashOrigin } from '@/lib/qstash';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { syncOrderExceptionsToOrders } from '@/lib/orders-exceptions';
import { formatPSTTimestamp } from '@/utils/date';

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

export async function POST(request: NextRequest) {
  if (!isQStashOrigin(request.headers) && !isTrustedAppOrigin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await syncOrderExceptionsToOrders();
    if (result.matched > 0) {
      await invalidateCacheTags(['orders']);
    }
    return NextResponse.json({
      success: true,
      ...result,
      timestamp: formatPSTTimestamp(),
    });
  } catch (error: any) {
    console.error('Error syncing orders_exceptions:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to sync orders_exceptions',
      },
      { status: 500 }
    );
  }
}
