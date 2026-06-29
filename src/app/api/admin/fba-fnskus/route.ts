import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(req.url);
    const q = String(searchParams.get('q') || '').trim();
    const limitParam = Number(searchParams.get('limit') || 200);
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(1000, Math.floor(limitParam))) : 200;

    const hasQuery = q.length > 0;
    // Deactivated rows (is_active = FALSE, set by DELETE) are hidden from the
    // catalog. NULL is treated as active so legacy rows still show.
    // $1 is always organization_id; query/limit placeholders shift up by one.
    const whereSql = hasQuery
      ? `
        WHERE organization_id = $1
          AND is_active IS NOT FALSE
          AND (
            COALESCE(product_title, '') ILIKE $2
            OR COALESCE(asin, '') ILIKE $2
            OR COALESCE(sku, '') ILIKE $2
            OR COALESCE(fnsku, '') ILIKE $2
          )
      `
      : `WHERE organization_id = $1 AND is_active IS NOT FALSE`;
    const params = hasQuery ? [ctx.organizationId, `%${q}%`, limit] : [ctx.organizationId, limit];

    const orderSql = `
      ORDER BY
        CASE
          WHEN (product_title IS NULL OR TRIM(COALESCE(product_title, '')) = '')
           AND (asin IS NULL OR TRIM(COALESCE(asin, '')) = '')
           AND (sku IS NULL OR TRIM(COALESCE(sku, '')) = '')
          THEN 0
          ELSE 1
        END,
        CASE
          WHEN (product_title IS NULL OR TRIM(COALESCE(product_title, '')) = '')
           AND (asin IS NULL OR TRIM(COALESCE(asin, '')) = '')
           AND (sku IS NULL OR TRIM(COALESCE(sku, '')) = '')
          THEN COALESCE(fnsku, '')
          ELSE COALESCE(NULLIF(TRIM(product_title), ''), '')
        END ASC,
        COALESCE(fnsku, '') ASC
    `;

    const result = await tenantQuery(
      ctx.organizationId,
      `
        SELECT product_title, asin, sku, fnsku
        FROM fba_fnskus
        ${whereSql}
        ${orderSql}
        LIMIT $${hasQuery ? 3 : 2}
      `,
      params
    );

    return NextResponse.json({ rows: result.rows });
  } catch (error: any) {
    console.error('Failed to fetch fba_fnskus rows:', error);
    return NextResponse.json({ error: 'Failed to fetch fba_fnskus rows' }, { status: 500 });
  }
}, { permission: 'fba.view' });

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json();
    const productTitle = String(body?.product_title || '').trim();
    const asin = String(body?.asin || '').trim();
    const sku = String(body?.sku || '').trim();
    const fnsku = String(body?.fnsku || '').trim().toUpperCase();

    if (!fnsku) {
      return NextResponse.json({ error: 'fnsku is required' }, { status: 400 });
    }

    await tenantQuery(
      ctx.organizationId,
      `
        INSERT INTO fba_fnskus (fnsku, product_title, asin, sku, organization_id, is_active, last_seen_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())
        ON CONFLICT (organization_id, fnsku) DO UPDATE
          SET product_title = EXCLUDED.product_title,
              asin = EXCLUDED.asin,
              sku = EXCLUDED.sku,
              is_active = TRUE,
              last_seen_at = NOW(),
              updated_at = NOW()
        WHERE fba_fnskus.organization_id = EXCLUDED.organization_id
      `,
      [fnsku, productTitle || null, asin || null, sku || null, ctx.organizationId]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to create fba_fnskus row:', error);
    return NextResponse.json({ error: 'Failed to create fba_fnskus row' }, { status: 500 });
  }
}, { permission: 'fba.manage_fnskus' });
