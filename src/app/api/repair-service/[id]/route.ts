import { NextRequest, NextResponse } from 'next/server';
import { getRepairById } from '@/lib/neon/repair-service-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';

/**
 * GET /api/rs/[id] - Fetch single repair by ID
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireRoutePerm(req, 'repair.view');
    if (gate.denied) return gate.denied;
    const { id } = await params;
    const repairId = parseInt(id);

    if (isNaN(repairId)) {
      return NextResponse.json(
        { error: 'Invalid ID' },
        { status: 400 }
      );
    }

    const repair = await getRepairById(repairId);

    if (!repair) {
      return NextResponse.json(
        { error: 'Repair not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(repair);
  } catch (error: any) {
    console.error(`Error in GET /api/rs/${(await params).id}:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch repair', details: error.message },
      { status: 500 }
    );
  }
}
