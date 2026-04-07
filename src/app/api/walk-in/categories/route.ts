import { NextRequest, NextResponse } from 'next/server';
import { squareFetch, formatSquareErrors } from '@/lib/square/client';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';

const REPAIR_SERVICE_CATEGORY_NAME = 'Repair Service';

interface SquareCategory {
  id: string;
  type: string;
  category_data?: {
    name?: string;
  };
}

/**
 * GET /api/walk-in/categories
 * Fetch Square catalog categories, excluding Repair Service.
 */
export async function GET(req: NextRequest) {
  try {
    if (!isAllowedAdminOrigin(req)) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }

    const result = await squareFetch<{ objects?: SquareCategory[] }>(
      '/catalog/search',
      { method: 'POST', body: { object_types: ['CATEGORY'], limit: 100 } },
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: formatSquareErrors(result.errors) },
        { status: 502 },
      );
    }

    const allCategories = (result.data.objects || [])
      .map((c) => ({
        id: c.id,
        name: c.category_data?.name || 'Unknown',
      }))
      .filter((c) => c.name.toLowerCase() !== REPAIR_SERVICE_CATEGORY_NAME.toLowerCase());

    return NextResponse.json({ categories: allCategories });
  } catch (error: unknown) {
    console.error('GET /api/walk-in/categories error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
