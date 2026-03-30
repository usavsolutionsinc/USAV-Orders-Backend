import { NextRequest, NextResponse } from 'next/server';
import {
  createCacheLookupKey,
  getCachedJson,
  invalidateCacheTags,
  setCachedJson,
} from '@/lib/cache/upstash-cache';
import { ApiError, errorResponse } from './errors';
import type { CrudConfig, CrudListParams } from './types';

/**
 * Creates a unified CRUD route handler from a configuration object.
 *
 * Returns `{ GET, POST, PATCH, DELETE }` — spread directly into a Next.js route file:
 * ```ts
 * const handler = createCrudHandler({ ... });
 * export const { GET, POST, PATCH, DELETE } = handler;
 * ```
 *
 * Features:
 * - Automatic Upstash caching on GET with tag-based invalidation on mutations
 * - Zod validation on POST/PATCH bodies
 * - Consistent error responses (400/404/409/500) via ApiError
 * - Hooks for business logic (beforeCreate, afterCreate, etc.)
 * - Pagination, search, tab, sort param parsing
 * - x-cache: HIT/MISS headers for debugging
 */
export function createCrudHandler<TRow = any>(config: CrudConfig<TRow>) {
  const {
    name,
    cacheNamespace,
    cacheTTL = 300,
    cacheTags = [],
    createSchema,
    updateSchema,
    list,
    getById,
    search,
    create,
    update,
    remove,
    hooks = {},
  } = config;

  // ── Helpers ────────────────────────────────────────────────

  function parseListParams(req: NextRequest): CrudListParams {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const offset = (page - 1) * limit;
    const searchQuery = (searchParams.get('q') || searchParams.get('search') || '').trim();
    const tab = (searchParams.get('tab') || '').trim();
    const sort = (searchParams.get('sort') || '').trim();
    return { page, limit, offset, search: searchQuery, tab, sort, searchParams };
  }

  async function invalidateCache() {
    if (cacheTags.length > 0) {
      await invalidateCacheTags(cacheTags);
    }
  }

  // ── GET ────────────────────────────────────────────────────

  async function GET(req: NextRequest): Promise<NextResponse> {
    try {
      const { searchParams } = new URL(req.url);
      const idParam = searchParams.get('id');

      // Single-row fetch by ID
      if (idParam && getById) {
        const id = /^\d+$/.test(idParam) ? Number(idParam) : idParam;

        // Check cache for single row
        if (cacheNamespace) {
          const cached = await getCachedJson<TRow>(cacheNamespace, `id:${id}`);
          if (cached) return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
        }

        const row = await getById(id);
        if (!row) throw ApiError.notFound(name, id);

        if (cacheNamespace) {
          await setCachedJson(cacheNamespace, `id:${id}`, row, cacheTTL, cacheTags);
        }
        return NextResponse.json(row, { headers: { 'x-cache': 'MISS' } });
      }

      // List / search
      const params = parseListParams(req);

      // Build cache key from all query params
      if (cacheNamespace) {
        const cacheKey = createCacheLookupKey({
          q: params.search,
          page: params.page,
          limit: params.limit,
          tab: params.tab,
          sort: params.sort,
          // Include any extra params the consumer may rely on
          ...Object.fromEntries(searchParams.entries()),
        });
        const cached = await getCachedJson<any>(cacheNamespace, cacheKey);
        if (cached) return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
      }

      let payload: any;

      // Use search handler if available and a query is present
      if (params.search && search) {
        const rows = await search(params.search, params);
        payload = { rows, count: rows.length, query: params.search, tab: params.tab };
      } else {
        const result = await list(params);
        payload = {
          rows: result.rows,
          total: result.total,
          page: params.page,
          limit: params.limit,
          count: result.rows.length,
          tab: params.tab || undefined,
        };
      }

      if (cacheNamespace) {
        const cacheKey = createCacheLookupKey({
          q: params.search,
          page: params.page,
          limit: params.limit,
          tab: params.tab,
          sort: params.sort,
          ...Object.fromEntries(searchParams.entries()),
        });
        await setCachedJson(cacheNamespace, cacheKey, payload, cacheTTL, cacheTags);
      }

      return NextResponse.json(payload, { headers: { 'x-cache': 'MISS' } });
    } catch (err) {
      return errorResponse(err, `GET /api/${name}`);
    }
  }

  // ── POST ───────────────────────────────────────────────────

  async function POST(req: NextRequest): Promise<NextResponse> {
    if (!create) {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
      let body = await req.json();

      // Validate with Zod if schema provided
      if (createSchema) {
        body = createSchema.parse(body);
      }

      // Run beforeCreate hook
      if (hooks.beforeCreate) {
        body = await hooks.beforeCreate(body);
      }

      const row = await create(body, req);

      // Invalidate cache after mutation
      await invalidateCache();

      // Run afterCreate hook (fire-and-forget)
      if (hooks.afterCreate) {
        hooks.afterCreate(row).catch((err) =>
          console.warn(`[${name}] afterCreate hook failed:`, err),
        );
      }

      return NextResponse.json(row, { status: 201 });
    } catch (err) {
      return errorResponse(err, `POST /api/${name}`);
    }
  }

  // ── PATCH ──────────────────────────────────────────────────

  async function PATCH(req: NextRequest): Promise<NextResponse> {
    if (!update) {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
      let body = await req.json();

      // Validate with Zod if schema provided
      if (updateSchema) {
        body = updateSchema.parse(body);
      }

      // Run beforeUpdate hook
      if (hooks.beforeUpdate) {
        body = await hooks.beforeUpdate(body);
      }

      const result = await update(body, req);

      // Invalidate cache after mutation
      await invalidateCache();

      // Run afterUpdate hook (fire-and-forget)
      if (hooks.afterUpdate) {
        hooks.afterUpdate(result).catch((err) =>
          console.warn(`[${name}] afterUpdate hook failed:`, err),
        );
      }

      return NextResponse.json(result);
    } catch (err) {
      return errorResponse(err, `PATCH /api/${name}`);
    }
  }

  // ── DELETE ─────────────────────────────────────────────────

  async function DELETE(req: NextRequest): Promise<NextResponse> {
    if (!remove) {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
      const { searchParams } = new URL(req.url);
      const idParam = searchParams.get('id');

      if (!idParam) throw ApiError.badRequest('id query parameter is required');

      const id = /^\d+$/.test(idParam) ? Number(idParam) : idParam;

      if (typeof id === 'number' && (!Number.isFinite(id) || id <= 0)) {
        throw ApiError.badRequest('Valid positive id is required');
      }

      // Run beforeDelete hook
      if (hooks.beforeDelete) {
        await hooks.beforeDelete(id);
      }

      const result = await remove(id, req);

      // Invalidate cache after mutation
      await invalidateCache();

      // Run afterDelete hook (fire-and-forget)
      if (hooks.afterDelete) {
        hooks.afterDelete(id).catch((err) =>
          console.warn(`[${name}] afterDelete hook failed:`, err),
        );
      }

      return NextResponse.json(result);
    } catch (err) {
      return errorResponse(err, `DELETE /api/${name}`);
    }
  }

  return { GET, POST, PATCH, DELETE };
}
