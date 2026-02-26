import { NextRequest, NextResponse } from 'next/server';
import { getAllShippedOrders, updateShippedOrderField, searchShippedOrders } from '@/lib/neon/orders-queries';
import { createCacheLookupKey, getCachedJson, invalidateCacheTags, setCachedJson } from '@/lib/cache/upstash-cache';

/**
 * GET /api/shipped - Fetch all shipped records (paginated) or search
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const cacheLookup = createCacheLookupKey({ query: query || '', page, limit });

    const cached = await getCachedJson<any>('api:shipped', cacheLookup);
    if (cached) {
      return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
    }

    if (query) {
      const results = await searchShippedOrders(query);
      const payload = {
        shipped: results,
        results,
        count: results.length,
        query
      };
      await setCachedJson('api:shipped', cacheLookup, payload, 25, ['shipped']);
      return NextResponse.json(payload, { headers: { 'x-cache': 'MISS' } });
    }

    const offset = (page - 1) * limit;

    const shipped = await getAllShippedOrders(limit, offset);
    const payload = {
      shipped,
      page,
      limit,
      count: shipped.length,
    };
    await setCachedJson('api:shipped', cacheLookup, payload, 25, ['shipped']);
    return NextResponse.json(payload, { headers: { 'x-cache': 'MISS' } });
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

    // Update generic field if provided
    if (field && value !== undefined) {
      await updateShippedOrderField(id, field, value);
    }

    await invalidateCacheTags(['shipped', 'orders']);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in PATCH /api/shipped:', error);
    return NextResponse.json(
      { error: 'Failed to update shipped record', details: error.message },
      { status: 500 }
    );
  }
}
