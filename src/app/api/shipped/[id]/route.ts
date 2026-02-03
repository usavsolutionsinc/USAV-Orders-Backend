import { NextRequest, NextResponse } from 'next/server';
import { getShippedOrderById } from '@/lib/neon/orders-queries';

/**
 * GET /api/shipped/[id] - Fetch single shipped record by ID
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const shippedId = parseInt(id);

    if (isNaN(shippedId)) {
      return NextResponse.json(
        { error: 'Invalid ID' },
        { status: 400 }
      );
    }

    const shipped = await getShippedOrderById(shippedId);

    if (!shipped) {
      return NextResponse.json(
        { error: 'Shipped order not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(shipped);
  } catch (error: any) {
    console.error(`Error in GET /api/shipped/${(await params).id}:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch shipped record', details: error.message },
      { status: 500 }
    );
  }
}
