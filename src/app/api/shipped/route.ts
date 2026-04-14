import { NextRequest, NextResponse } from 'next/server';
import { getAllShippedOrders, updateShippedOrderField, searchShippedOrders, type ShippedFilterMode, type ShippedOrder } from '@/lib/neon/orders-queries';
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
    // Cache namespace bumped to v2 — the search SQL now uses ORDER_SERIALS_CTE_ALL
    // and a demoted numeric-pk score. Serving v1 entries would mask the fix.
    const CACHE_NS = 'api:shipped:v2';
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

    const cached = await getCachedJson<any>(CACHE_NS, cacheLookup);
    if (cached) {
      ok = true;
      cache = 'HIT';
      return NextResponse.json(cached, { headers: { 'x-cache': 'HIT', ...CACHE_HEADERS } });
    }

    if (query) {
      const applyScopeFilters = (rows: ShippedOrder[]): ShippedOrder[] => {
        let filtered = rows;
        const packedById = packedBy ? Number(packedBy) : null;
        const testedById = testedBy ? Number(testedBy) : null;
        if (packedById != null && Number.isFinite(packedById)) {
          filtered = filtered.filter((record) => Number(record.packed_by) === packedById);
        }
        if (testedById != null && Number.isFinite(testedById)) {
          filtered = filtered.filter((record) => Number(record.tested_by) === testedById);
        }
        if (missingTrackingOnly) {
          filtered = filtered.filter((record) => !String(record.shipping_tracking_number || '').trim());
        }
        return filtered;
      };

      const searchResult = await searchShippedOrders(query, { shippedFilter, searchField });
      let results = applyScopeFilters(searchResult.rows);

      // Out-of-scope hint: if the current tab (shippedFilter) has no matches but
      // the match exists under a different filter, expose a suggestion so the UI
      // can tell the user "found in FBA — switch tab" instead of silently empty.
      let outOfScope = false;
      let outOfScopeSuggestion: { filter: string; count: number } | null = null;
      if (results.length === 0 && shippedFilter !== 'all') {
        const broad = await searchShippedOrders(query, { shippedFilter: 'all', searchField });
        const broadFiltered = applyScopeFilters(broad.rows);
        if (broadFiltered.length > 0) {
          outOfScope = true;
          // Derive a suggested tab from the first result's shape.
          const sample = broadFiltered[0];
          const isFba =
            String(sample.account_source || '').toLowerCase() === 'fba'
            || /^FBA/i.test(String(sample.order_id || ''));
          const hasSku = !!String(sample.sku || '').trim();
          const suggested = isFba ? 'fba' : hasSku && !sample.order_id ? 'sku' : 'orders';
          outOfScopeSuggestion = { filter: suggested, count: broadFiltered.length };
        }
      }

      const payload = {
        shipped: results,
        results,
        count: results.length,
        query,
        searchField,
        outOfScope,
        outOfScopeSuggestion,
      };
      await setCachedJson(CACHE_NS, cacheLookup, payload, 300, ['shipped']);
      ok = true;
      cache = 'MISS';
      return NextResponse.json(payload, {
        headers: {
          'x-cache': 'MISS',
          'x-search-debug': JSON.stringify(searchResult.debug),
          ...CACHE_HEADERS,
        },
      });
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
