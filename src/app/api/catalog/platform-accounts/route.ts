import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { PlatformAccountCreateBody } from '@/lib/schemas/catalog';
import {
  createPlatformAccount,
  getPlatformById,
  listPlatformAccounts,
  slugify,
} from '@/lib/neon/catalog-queries';
import { invalidateCatalogCache } from '@/lib/catalog/org-catalog';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';

const ROUTE_ACCOUNTS_POST = 'catalog.platform-accounts.post';

/**
 * GET /api/catalog/platform-accounts — the org's storefront accounts (active by
 * default). Optional `?platformId=` filters to one channel.
 */
export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const url = new URL(req.url);
      const includeInactive = url.searchParams.get('includeInactive') === 'true';
      const platformIdRaw = url.searchParams.get('platformId');
      const platformId = platformIdRaw ? Number(platformIdRaw) : undefined;
      if (platformIdRaw && (!Number.isFinite(platformId) || (platformId as number) <= 0)) {
        return NextResponse.json({ success: false, error: 'Invalid platformId' }, { status: 400 });
      }
      const accounts = await listPlatformAccounts(ctx.organizationId, { includeInactive, platformId });
      return NextResponse.json({ success: true, accounts });
    } catch (error: any) {
      console.error('Error in GET /api/catalog/platform-accounts:', error);
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to fetch platform accounts' },
        { status: 500 },
      );
    }
  },
  { permission: 'receiving.view' },
);

/** POST /api/catalog/platform-accounts — add a storefront account under a platform. */
export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const raw = await req.json().catch(() => ({}));
      const parsed = parseBody(PlatformAccountCreateBody, raw);
      if (parsed instanceof NextResponse) return parsed;

      const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
      if (idemKey) {
        const hit = await getApiIdempotencyResponse(pool, idemKey, ROUTE_ACCOUNTS_POST);
        if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
      }

      // The platform must belong to this org (org-scoped read); guards against
      // attaching an account to another tenant's channel id.
      const platform = await getPlatformById(ctx.organizationId, parsed.platformId);
      if (!platform) {
        return NextResponse.json({ success: false, error: 'Platform not found' }, { status: 404 });
      }

      const slug = parsed.slug ?? slugify(parsed.label);
      if (!slug) {
        return NextResponse.json({ success: false, error: 'Could not derive a slug from the label' }, { status: 400 });
      }

      const account = await createPlatformAccount(ctx.organizationId, {
        platformId: parsed.platformId,
        slug,
        label: parsed.label,
        integrationScope: parsed.integrationScope ?? null,
      });

      await recordAudit(pool, ctx, req, {
        source: 'catalog-api',
        action: 'catalog.platform_account.create',
        entityType: 'catalog_platform_account',
        entityId: account.id,
        before: null,
        after: { ...account },
      });
      invalidateCatalogCache(ctx.organizationId);

      const responseBody = { success: true, account };
      if (idemKey) {
        await saveApiIdempotencyResponse(pool, {
          idempotencyKey: idemKey,
          route: ROUTE_ACCOUNTS_POST,
          staffId: ctx.staffId,
          statusCode: 201,
          responseBody,
        });
      }
      return NextResponse.json(responseBody, { status: 201 });
    } catch (error: any) {
      if (error?.code === '23505' || /unique/i.test(error?.message || '')) {
        return NextResponse.json(
          { success: false, error: 'An account with that slug already exists on this platform' },
          { status: 409 },
        );
      }
      console.error('Error in POST /api/catalog/platform-accounts:', error);
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to create platform account' },
        { status: 500 },
      );
    }
  },
  { permission: 'admin.manage_features' },
);
