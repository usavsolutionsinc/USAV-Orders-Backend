import { NextRequest, NextResponse } from 'next/server';
import { listWarehouses } from '@/lib/zoho';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get('page') || 1);
    const perPage = Number(searchParams.get('per_page') || 200);

    const data = await listWarehouses({
      page: Number.isFinite(page) && page > 0 ? page : 1,
      per_page: Number.isFinite(perPage) && perPage > 0 ? Math.min(perPage, 200) : 200,
    });

    return NextResponse.json({
      success: true,
      ...data,
    });
  } catch (error: any) {
    console.error('Zoho warehouses API failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to fetch Zoho warehouses',
      },
      { status: 500 }
    );
  }
}
