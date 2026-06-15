import { NextRequest, NextResponse } from 'next/server';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';

/**
 * POST /api/orders-exceptions/delete - Delete one or more exception rows
 * Body: { exceptionId?: number, exceptionIds?: number[] }
 *
 * Destructive — gated to orders.void + stepUp.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId;
    const body = await req.json();
    const { exceptionId, exceptionIds } = body;

    if (!exceptionId && (!exceptionIds || !Array.isArray(exceptionIds) || exceptionIds.length === 0)) {
      return NextResponse.json(
        { error: 'exceptionId or exceptionIds array is required' },
        { status: 400 }
      );
    }

    const idsToDelete: number[] = exceptionId ? [exceptionId] : exceptionIds;
    const placeholders = idsToDelete.map((_, idx) => `$${idx + 1}`).join(', ');
    // Org-scope the delete so a tenant can only remove its own exception rows
    // (rows are addressed by surrogate id; without this an id from another org
    // would be deletable). orgParam is the last positional after the id list.
    const orgParam = `$${idsToDelete.length + 1}`;

    const result = await tenantQuery(
      orgId,
      `DELETE FROM orders_exceptions WHERE id IN (${placeholders}) AND organization_id = ${orgParam}`,
      [...idsToDelete, orgId]
    );

    await invalidateCacheTags(['orders', 'shipped']);
    return NextResponse.json({ success: true, deleted: result.rowCount || 0 });
  } catch (error: any) {
    console.error('Error deleting orders_exceptions row(s):', error);
    return NextResponse.json(
      { error: 'Failed to delete orders_exceptions row(s)', details: error.message },
      { status: 500 }
    );
  }
}, { permission: 'orders.void' });
