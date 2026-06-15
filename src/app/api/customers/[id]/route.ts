import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/customers/[id]
 * Single customer (buyer contact + shipping address) for the current org.
 * Used by the order details Customer tab (e.g. Amazon MFN shipping contact).
 */
export const GET = withAuth(async (req, ctx) => {
  const id = Number(req.nextUrl.pathname.split('/').filter(Boolean).pop());
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid customer id' }, { status: 400 });
  }

  const { rows } = await tenantQuery(
    ctx.organizationId,
    `SELECT id, display_name, customer_name, first_name, last_name,
            email, phone, mobile,
            shipping_address_1, shipping_address_2, shipping_city,
            shipping_state, shipping_postal_code, shipping_country,
            channel_refs, created_at
       FROM customers
      WHERE id = $1 AND organization_id = $2
      LIMIT 1`,
    [id, ctx.organizationId],
  );

  if (!rows[0]) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, customer: rows[0] });
}, { permission: 'orders.view' });
