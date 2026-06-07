import { NextRequest, NextResponse } from 'next/server';
import {
  createSupplier,
  getSupplierByEbaySellerId,
  getSupplierList,
} from '@/lib/neon/suppliers-queries';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { SupplierCreateBody } from '@/lib/schemas/supplier';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

const ROUTE_SUPPLIERS_POST = 'suppliers.post';

/**
 * GET /api/suppliers — Paginated supplier list. Query: q, type, limit, offset.
 */
export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q') || '';
    const type = searchParams.get('type');
    const limit = Math.max(1, Math.min(500, Number(searchParams.get('limit') || 100)));
    const offset = Math.max(0, Number(searchParams.get('offset') || 0));

    const { items, total } = await getSupplierList({ q, type, limit, offset });
    return NextResponse.json({ success: true, items, total });
  } catch (error: any) {
    console.error('Error in GET /api/suppliers:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch suppliers' },
      { status: 500 },
    );
  }
}, { permission: 'supplier.view' });

/**
 * POST /api/suppliers — Create a supplier.
 *
 * eBay sellers are normally auto-created on import; this is the manual-entry
 * path. When `ebaySellerId` is supplied and already exists, returns 409
 * (the existing seller). A retried create replays via `Idempotency-Key`.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(SupplierCreateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, idemKey, ROUTE_SUPPLIERS_POST);
      if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
    }

    // eBay seller ids are unique — a dupe is a 409 pointing at the existing row.
    if (parsed.ebaySellerId?.trim()) {
      const existing = await getSupplierByEbaySellerId(parsed.ebaySellerId);
      if (existing) {
        return NextResponse.json(
          { success: false, error: 'A supplier with that eBay seller id already exists', id: existing.id },
          { status: 409 },
        );
      }
    }

    const supplier = await createSupplier({
      name: parsed.name,
      supplierType: parsed.supplierType,
      email: parsed.email ?? null,
      phone: parsed.phone ?? null,
      url: parsed.url ?? null,
      ebaySellerId: parsed.ebaySellerId ?? null,
      rating: parsed.rating ?? null,
      leadTimeDays: parsed.leadTimeDays ?? null,
      notes: parsed.notes ?? null,
      isActive: parsed.isActive ?? true,
    });

    await recordAudit(pool, ctx, req, {
      source: 'suppliers-api',
      action: AUDIT_ACTION.SUPPLIER_CREATE,
      entityType: AUDIT_ENTITY.SUPPLIER,
      entityId: supplier.id,
      before: null,
      after: { ...supplier },
    });

    const responseBody = { success: true, supplier };
    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        idempotencyKey: idemKey,
        route: ROUTE_SUPPLIERS_POST,
        staffId: ctx.staffId,
        statusCode: 201,
        responseBody,
      });
    }

    return NextResponse.json(responseBody, { status: 201 });
  } catch (error: any) {
    if (error?.code === '23505' || /unique/i.test(error?.message || '')) {
      return NextResponse.json(
        { success: false, error: 'A supplier with that eBay seller id already exists' },
        { status: 409 },
      );
    }
    console.error('Error in POST /api/suppliers:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create supplier' },
      { status: 500 },
    );
  }
}, { permission: 'supplier.manage' });
