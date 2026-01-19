import { NextRequest, NextResponse } from 'next/server';
import { getAllShipped, updateShippedStatus, updateShippedField, searchShipped } from '@/lib/neon/shipped-queries';

/**
 * GET /api/shipped - Fetch all shipped records (paginated) or search
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');

    if (query) {
      const results = await searchShipped(query);
      return NextResponse.json({
        shipped: results,
        results,
        count: results.length,
        query
      });
    }

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;

    const shipped = await getAllShipped(limit, offset);
    
    return NextResponse.json({
      shipped,
      page,
      limit,
      count: shipped.length,
    });
  } catch (error: any) {
    console.error('Error in GET /api/shipped:', error);
    return NextResponse.json(
      { error: 'Failed to fetch shipped records', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/shipped - Update status or fields
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status, field, value } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'ID is required' },
        { status: 400 }
      );
    }

    // Update status if provided
    if (status) {
      await updateShippedStatus(id, status);
    }

    // Update generic field if provided
    if (field && value !== undefined) {
      await updateShippedField(id, field, value);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in PATCH /api/shipped:', error);
    return NextResponse.json(
      { error: 'Failed to update shipped record', details: error.message },
      { status: 500 }
    );
  }
}
