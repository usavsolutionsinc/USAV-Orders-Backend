import { NextRequest, NextResponse } from 'next/server';
import { getAllRepairs, updateRepairStatus, updateRepairNotes, updateRepairField, searchRepairs } from '@/lib/neon/repair-service-queries';

/**
 * GET /api/rs - Fetch all repairs (paginated) or search
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');
    
    if (query) {
      const repairs = await searchRepairs(query);
      return NextResponse.json({
        repairs,
        count: repairs.length,
        query
      });
    }

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;

    const repairs = await getAllRepairs(limit, offset);
    
    return NextResponse.json({
      repairs,
      page,
      limit,
      count: repairs.length,
    });
  } catch (error: any) {
    console.error('Error in GET /api/rs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch repairs', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/rs - Update status or fields
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status, notes, field, value } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'ID is required' },
        { status: 400 }
      );
    }

    // Update status if provided
    if (status) {
      await updateRepairStatus(id, status);
    }

    // Update notes if provided
    if (notes !== undefined) {
      await updateRepairNotes(id, notes);
    }

    // Update generic field if provided
    if (field && value !== undefined) {
      await updateRepairField(id, field, value);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in PATCH /api/rs:', error);
    return NextResponse.json(
      { error: 'Failed to update repair', details: error.message },
      { status: 500 }
    );
  }
}
