import { NextRequest, NextResponse } from 'next/server';
import { appendRepairStatusHistory, getAllRepairs, updateRepairStatus, updateRepairNotes, updateRepairField, searchRepairs, type RepairTab } from '@/lib/neon/repair-service-queries';
import { createCacheLookupKey, getCachedJson, invalidateCacheTags, setCachedJson } from '@/lib/cache/upstash-cache';
import { publishRepairChanged } from '@/lib/realtime/publish';

const REPAIR_CACHE_NS = 'api:repair-service';
const REPAIR_TTL = 300;
const REPAIR_TAGS = ['repair-service'];

/**
 * GET /api/repair-service - Fetch all repairs (paginated) or search
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const tabParam = searchParams.get('tab');
    const tab: RepairTab = tabParam === 'incoming' ? 'incoming' : tabParam === 'done' ? 'done' : 'active';
    const cacheLookup = createCacheLookupKey({ query: query || '', page, limit, tab });

    const cached = await getCachedJson<any>(REPAIR_CACHE_NS, cacheLookup);
    if (cached) {
      return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
    }

    if (query) {
      const repairs = await searchRepairs(query, { tab });
      const payload = { repairs, count: repairs.length, query, tab };
      await setCachedJson(REPAIR_CACHE_NS, cacheLookup, payload, REPAIR_TTL, REPAIR_TAGS);
      return NextResponse.json(payload, { headers: { 'x-cache': 'MISS' } });
    }

    const offset = (page - 1) * limit;
    const repairs = await getAllRepairs(limit, offset, { tab });
    const payload = { repairs, page, limit, count: repairs.length, tab };
    await setCachedJson(REPAIR_CACHE_NS, cacheLookup, payload, REPAIR_TTL, REPAIR_TAGS);
    return NextResponse.json(payload, { headers: { 'x-cache': 'MISS' } });
  } catch (error: any) {
    console.error('Error in GET /api/repair-service:', error);
    return NextResponse.json(
      { error: 'Failed to fetch repairs', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/repair-service - Update status or fields, then invalidate cache
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status, notes, field, value, statusHistoryEntry } = body;

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    if (status) {
      await updateRepairStatus(id, status);
    }
    if (notes !== undefined) {
      await updateRepairNotes(id, notes);
    }
    if (field && value !== undefined) {
      await updateRepairField(id, field, value);
    }
    if (statusHistoryEntry) {
      await appendRepairStatusHistory(id, statusHistoryEntry);
    }

    await invalidateCacheTags(REPAIR_TAGS);
    await publishRepairChanged({ repairIds: [Number(id)], source: 'repair-service.patch' });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in PATCH /api/repair-service:', error);
    return NextResponse.json(
      { error: 'Failed to update repair', details: error.message },
      { status: 500 }
    );
  }
}
