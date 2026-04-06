import { NextRequest, NextResponse } from 'next/server';
import { isQStashOrigin } from '@/lib/qstash';
import { syncOrderExceptionsToOrders } from '@/lib/orders-exceptions';
import { formatPSTTimestamp } from '@/utils/date';

export async function POST(request: NextRequest) {
  if (!isQStashOrigin(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await syncOrderExceptionsToOrders();
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
