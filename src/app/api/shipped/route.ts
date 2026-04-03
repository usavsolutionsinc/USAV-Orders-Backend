import { NextRequest, NextResponse } from 'next/server';
import { getAllShippedOrders, updateShippedOrderField, searchShippedOrders, type ShippedFilterMode } from '@/lib/neon/orders-queries';
import { createCacheLookupKey, getCachedJson, invalidateCacheTags, setCachedJson } from '@/lib/cache/upstash-cache';
import { logRouteMetric } from '@/lib/route-metrics';
import { normalizeShippedSearchField } from '@/lib/shipped-search';

const CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=300, stale-while-revalidate=60',
};

/**
 * GET /api/shipped - Fetch all shipped records (paginated/filtered) or search
 *
 * Supports optional weekStart/weekEnd (YYYY-MM-DD), packedBy, testedBy, and
 * missingTrackingOnly filters. Filters are pushed down to SQL so pagination
 * remains lightweight for dashboard views.
 */
export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  let ok = false;
  let cache = 'BYPASS';
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const weekStart = searchParams.get('weekStart') || '';
    const weekEnd = searchParams.get('weekEnd') || '';
    const packedBy = searchParams.get('packedBy') || '';
    const testedBy = searchParams.get('testedBy') || '';
    const missingTrackingOnly = searchParams.get('missingTrackingOnly') === 'true';
    const rawShippedFilter = searchParams.get('shippedFilter') || '';
    const shippedFilter: ShippedFilterMode =
      rawShippedFilter === 'orders' ? 'orders'
      : rawShippedFilter === 'fba' ? 'fba'
      : rawShippedFilter === 'sku' ? 'sku'
      : 'all';
    const searchField = normalizeShippedSearchField(searchParams.get('searchField'));
    const cacheLookup = createCacheLookupKey({
      query: query || '',
      searchField,
      page,
      limit,
      weekStart,
      weekEnd,
      packedBy,
      testedBy,
      missingTrackingOnly,
      shippedFilter,
    });

    const cached = await getCachedJson<any>('api:shipped', cacheLookup);
    if (cached) {
      ok = true;
      cache = 'HIT';
      return NextResponse.json(cached, { headers: { 'x-cache': 'HIT', ...CACHE_HEADERS } });
    }

    if (query) {
      let results = await searchShippedOrders(query, { shippedFilter, searchField });
      const packedById = packedBy ? Number(packedBy) : null;
      const testedById = testedBy ? Number(testedBy) : null;

      if (packedById != null && Number.isFinite(packedById)) {
        results = results.filter((record) => Number(record.packed_by) === packedById);
      }
      if (testedById != null && Number.isFinite(testedById)) {
        results = results.filter((record) => Number(record.tested_by) === testedById);
      }
      if (missingTrackingOnly) {
        results = results.filter((record) => !String(record.shipping_tracking_number || '').trim());
      }

      const payload = {
        shipped: results,
        results,
        count: results.length,
        query,
        searchField,
      };
      await setCachedJson('api:shipped', cacheLookup, payload, 300, ['shipped']);
      ok = true;
      cache = 'MISS';
      return NextResponse.json(payload, { headers: { 'x-cache': 'MISS', ...CACHE_HEADERS } });
    }

    const offset = (page - 1) * limit;
    const packedById = packedBy ? Number(packedBy) : null;
    const testedById = testedBy ? Number(testedBy) : null;
    const shipped = await getAllShippedOrders({
      limit,
      offset,
      weekStart: weekStart || undefined,
      weekEnd: weekEnd || undefined,
      packedBy: Number.isFinite(packedById) ? packedById : null,
      testedBy: Number.isFinite(testedById) ? testedById : null,
      missingTrackingOnly,
      shippedFilter,
    });

    const payload = {
      shipped,
      page,
      limit,
      count: shipped.length,
      weekStart: weekStart || null,
      weekEnd: weekEnd || null,
    };
    await setCachedJson('api:shipped', cacheLookup, payload, 300, ['shipped']);
    ok = true;
    cache = 'MISS';
    return NextResponse.json(payload, { headers: { 'x-cache': 'MISS', ...CACHE_HEADERS } });
  } catch (error: any) {
    console.error('Error in GET /api/shipped:', error);
    return NextResponse.json(
      { error: 'Failed to fetch shipped records', details: error.message },
      { status: 500 }
    );
  } finally {
    logRouteMetric({
      route: '/api/shipped',
      method: 'GET',
      startedAt,
      ok,
      details: { cache },
    });
  }
}

/**
 * PATCH /api/shipped - Update status or fields
 */
export async function PATCH(req: NextRequest) {
  const startedAt = Date.now();
  let ok = false;
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
    ok = true;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in PATCH /api/shipped:', error);
    return NextResponse.json(
      { error: 'Failed to update shipped record', details: error.message },
      { status: 500 }
    );
  } finally {
    logRouteMetric({
      route: '/api/shipped',
      method: 'PATCH',
      startedAt,
      ok,
    });
  }
}
