import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { PlatformCreateBody } from '@/lib/schemas/catalog';
import { createPlatform, listPlatforms, slugify } from '@/lib/neon/catalog-queries';
import { invalidateCatalogCache } from '@/lib/catalog/org-catalog';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';

const ROUTE_PLATFORMS_POST = 'catalog.platforms.post';

/** GET /api/catalog/platforms — the org's platform catalog (active by default). */
export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const includeInactive = new URL(req.url).searchParams.get('includeInactive') === 'true';
      const platforms = await listPlatforms(ctx.organizationId, { includeInactive });
      return NextResponse.json({ success: true, platforms });
    } catch (error: any) {
      console.error('Error in GET /api/catalog/platforms:', error);
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to fetch platforms' },
        { status: 500 },
      );
    }
  },
  { permission: 'receiving.view' },
);

/** POST /api/catalog/platforms — add a custom platform to the org catalog. */
export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const raw = await req.json().catch(() => ({}));
      const parsed = parseBody(PlatformCreateBody, raw);
      if (parsed instanceof NextResponse) return parsed;

      const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
      if (idemKey) {
        const hit = await getApiIdempotencyResponse(pool, idemKey, ROUTE_PLATFORMS_POST);
        if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
      }

      const slug = parsed.slug ?? slugify(parsed.label);
      if (!slug) {
        return NextResponse.json({ success: false, error: 'Could not derive a slug from the label' }, { status: 400 });
      }

      const platform = await createPlatform(ctx.organizationId, {
        slug,
        label: parsed.label,
        tone: parsed.tone ?? null,
        provider: parsed.provider ?? null,
        sortOrder: parsed.sortOrder,
      });

      await recordAudit(pool, ctx, req, {
        source: 'catalog-api',
        action: 'catalog.platform.create',
        entityType: 'catalog_platform',
        entityId: platform.id,
        before: null,
        after: { ...platform },
      });
      invalidateCatalogCache(ctx.organizationId);

      const responseBody = { success: true, platform };
      if (idemKey) {
        await saveApiIdempotencyResponse(pool, {
          idempotencyKey: idemKey,
          route: ROUTE_PLATFORMS_POST,
          staffId: ctx.staffId,
          statusCode: 201,
          responseBody,
        });
      }
      return NextResponse.json(responseBody, { status: 201 });
    } catch (error: any) {
      if (error?.code === '23505' || /unique/i.test(error?.message || '')) {
        return NextResponse.json(
          { success: false, error: 'A platform with that slug already exists' },
          { status: 409 },
        );
      }
      console.error('Error in POST /api/catalog/platforms:', error);
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to create platform' },
        { status: 500 },
      );
    }
  },
  { permission: 'admin.manage_features' },
);
