import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { withTenantTransaction } from '@/lib/tenancy/db';
import {
  resolveEntity,
  readJourneyEntity,
  readJourneyBrowse,
  encodeCursor,
  decodeCursor,
  clampLimit,
  JOURNEY_SOURCES,
  type JourneyDimension,
  type JourneyFilters,
  type JourneySource,
} from '@/lib/operations/journey';

/**
 * GET /api/operations/journey — the Master Operations Journey reader.
 *
 *   • ENTITY mode — pass `dim` + one of `order`/`serial`/`tracking`: returns that
 *     entity's complete cross-station journey (SAL + inventory + audit + carrier +
 *     warranty), org-gated. 404 if the entity isn't owned by the caller's org.
 *   • BROWSE mode — no entity: keyset-paginated recent activity, each row tagged
 *     with order/serial/tracking grouping keys so the client buckets journey bands.
 *
 * Read-only; org-scoped via `withTenantTransaction`. Rows are bucketed by `source`
 * with a `raw` payload matching each source's existing timeline adapter input.
 */

const DIMENSIONS: readonly JourneyDimension[] = ['order', 'serial', 'tracking'];

function parseDimension(raw: string | null): JourneyDimension {
  return DIMENSIONS.includes(raw as JourneyDimension) ? (raw as JourneyDimension) : 'order';
}

function csv(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseSources(raw: string | null): JourneySource[] | undefined {
  const vals = csv(raw)
    .map((s) => s.toLowerCase())
    .filter((s): s is JourneySource => (JOURNEY_SOURCES as readonly string[]).includes(s));
  return vals.length ? vals : undefined;
}

function parseStaffId(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export const GET = withAuth(
  async (request: NextRequest, ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const orgId = ctx.organizationId;

      const dim = parseDimension(searchParams.get('dim'));
      const entityValue =
        dim === 'order'
          ? searchParams.get('order')
          : dim === 'serial'
            ? searchParams.get('serial')
            : searchParams.get('tracking');

      const filters: JourneyFilters = {
        from: searchParams.get('from'),
        to: searchParams.get('until') || searchParams.get('to'),
        stations: csv(searchParams.get('stations')),
        types: csv(searchParams.get('types')),
        staffId: parseStaffId(searchParams.get('staffId')),
        status: searchParams.get('status') || null,
        sources: parseSources(searchParams.get('sources')),
        q: searchParams.get('q') || null,
        limit: clampLimit(Number(searchParams.get('limit'))),
      };

      // ENTITY mode — a specific order/serial/tracking is in focus.
      if (entityValue && entityValue.trim()) {
        const result = await withTenantTransaction(orgId, async (client) => {
          const anchors = await resolveEntity(client, orgId, dim, entityValue);
          if (!anchors) return { notFound: true as const };
          const events = await readJourneyEntity(client, orgId, anchors, filters);
          return { notFound: false as const, anchors, events };
        });

        if (result.notFound) {
          return NextResponse.json(
            { success: false, error: 'Entity not found' },
            { status: 404 },
          );
        }

        return NextResponse.json({
          success: true,
          mode: 'entity',
          entity: result.anchors,
          events: result.events,
          nextCursor: null,
          limit: filters.limit,
        });
      }

      // BROWSE mode — recent activity, keyset-paginated.
      const cursor = decodeCursor(searchParams.get('cursor'));
      const { events, nextCursor } = await withTenantTransaction(orgId, (client) =>
        readJourneyBrowse(client, orgId, filters, cursor),
      );

      return NextResponse.json({
        success: true,
        mode: 'browse',
        entity: null,
        events,
        nextCursor: nextCursor ? encodeCursor(nextCursor) : null,
        limit: filters.limit,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read journey';
      console.error('[GET /api/operations/journey] error:', error);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  },
  { permission: 'operations.view' },
);
