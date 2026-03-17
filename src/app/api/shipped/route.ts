import { NextRequest, NextResponse } from 'next/server';
import { getAllShippedOrders, updateShippedOrderField, searchShippedOrders } from '@/lib/neon/orders-queries';
import { createCacheLookupKey, getCachedJson, invalidateCacheTags, setCachedJson } from '@/lib/cache/upstash-cache';

const CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=300, stale-while-revalidate=60',
};

/**
 * GET /api/shipped - Fetch all shipped records (paginated/filtered) or search
 *
 * Supports optional weekStart/weekEnd (YYYY-MM-DD) params for the dashboard
 * shipped table so only the current week's ~50 records are returned instead
 * of up to 5 000 all-time records.
 */
export async function GET(req: NextRequest) {
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
    const cacheLookup = createCacheLookupKey({
      query: query || '',
      page,
      limit,
      weekStart,
      weekEnd,
      packedBy,
      testedBy,
      missingTrackingOnly,
    });

    const cached = await getCachedJson<any>('api:shipped', cacheLookup);
    if (cached) {
      return NextResponse.json(cached, { headers: { 'x-cache': 'HIT', ...CACHE_HEADERS } });
    }

    if (query) {
      let results = await searchShippedOrders(query);
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
        query
      };
      await setCachedJson('api:shipped', cacheLookup, payload, 300, ['shipped']);
      return NextResponse.json(payload, { headers: { 'x-cache': 'MISS', ...CACHE_HEADERS } });
    }

    const offset = (page - 1) * limit;
    const needsExpandedFetch = Boolean(weekStart || weekEnd || packedBy || testedBy || missingTrackingOnly);
    let shipped = await getAllShippedOrders(needsExpandedFetch ? 5000 : limit, needsExpandedFetch ? 0 : offset);

    // Apply server-side week filtering when requested (dashboard view uses this
    // to avoid downloading thousands of all-time records).
    if (weekStart && weekEnd) {
      shipped = shipped.filter((r) => {
        const dateKey = (r.packed_at || r.created_at || '').substring(0, 10);
        return dateKey >= weekStart && dateKey <= weekEnd;
      });
    }
    if (packedBy) {
      const packedById = Number(packedBy);
      if (Number.isFinite(packedById)) {
        shipped = shipped.filter((record) => Number(record.packed_by) === packedById);
      }
    }
    if (testedBy) {
      const testedById = Number(testedBy);
      if (Number.isFinite(testedById)) {
        shipped = shipped.filter((record) => Number(record.tested_by) === testedById);
      }
    }
    if (missingTrackingOnly) {
      shipped = shipped.filter((record) => !String(record.shipping_tracking_number || '').trim());
    }

    if (needsExpandedFetch) {
      shipped = shipped.slice(offset, offset + limit);
    }

    const payload = {
      shipped,
      page,
      limit,
      count: shipped.length,
      weekStart: weekStart || null,
      weekEnd: weekEnd || null,
    };
    await setCachedJson('api:shipped', cacheLookup, payload, 300, ['shipped']);
    return NextResponse.json(payload, { headers: { 'x-cache': 'MISS', ...CACHE_HEADERS } });
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
