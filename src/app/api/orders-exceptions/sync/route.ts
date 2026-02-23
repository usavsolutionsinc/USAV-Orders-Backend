import { NextResponse } from 'next/server';
import { syncOrderExceptionsToOrders } from '@/lib/orders-exceptions';

export async function POST() {
  try {
    const result = await syncOrderExceptionsToOrders();
    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
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
