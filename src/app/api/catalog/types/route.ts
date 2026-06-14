import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { TypeCreateBody } from '@/lib/schemas/catalog';
import { createType, listTypes, slugify } from '@/lib/neon/catalog-queries';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';

const ROUTE_TYPES_POST = 'catalog.types.post';

/** GET /api/catalog/types — the org's receiving flow types (active by default). */
export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const includeInactive = new URL(req.url).searchParams.get('includeInactive') === 'true';
      const types = await listTypes(ctx.organizationId, { includeInactive });
      return NextResponse.json({ success: true, types });
    } catch (error: any) {
      console.error('Error in GET /api/catalog/types:', error);
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to fetch types' },
        { status: 500 },
      );
    }
  },
  { permission: 'receiving.view' },
);

/** POST /api/catalog/types — add a custom receiving flow type to the org catalog. */
export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const raw = await req.json().catch(() => ({}));
      const parsed = parseBody(TypeCreateBody, raw);
      if (parsed instanceof NextResponse) return parsed;

      const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
      if (idemKey) {
        const hit = await getApiIdempotencyResponse(pool, idemKey, ROUTE_TYPES_POST);
        if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
      }

      const slug = parsed.slug ?? slugify(parsed.label);
      if (!slug) {
        return NextResponse.json({ success: false, error: 'Could not derive a slug from the label' }, { status: 400 });
      }

      const type = await createType(ctx.organizationId, {
        slug,
        label: parsed.label,
        kind: parsed.kind,
        isReturn: parsed.isReturn,
        sortOrder: parsed.sortOrder,
      });

      await recordAudit(pool, ctx, req, {
        source: 'catalog-api',
        action: 'catalog.type.create',
        entityType: 'catalog_type',
        entityId: type.id,
        before: null,
        after: { ...type },
      });

      const responseBody = { success: true, type };
      if (idemKey) {
        await saveApiIdempotencyResponse(pool, {
          idempotencyKey: idemKey,
          route: ROUTE_TYPES_POST,
          staffId: ctx.staffId,
          statusCode: 201,
          responseBody,
        });
      }
      return NextResponse.json(responseBody, { status: 201 });
    } catch (error: any) {
      if (error?.code === '23505' || /unique/i.test(error?.message || '')) {
        return NextResponse.json(
          { success: false, error: 'A type with that slug already exists' },
          { status: 409 },
        );
      }
      console.error('Error in POST /api/catalog/types:', error);
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to create type' },
        { status: 500 },
      );
    }
  },
  { permission: 'admin.manage_features' },
);
