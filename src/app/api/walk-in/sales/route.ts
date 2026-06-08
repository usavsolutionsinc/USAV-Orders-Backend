import { NextRequest, NextResponse } from 'next/server';
import {
  getSquareTransactions,
  softDeleteSquareTransaction,
} from '@/lib/neon/square-transaction-queries';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * GET /api/walk-in/sales?q=&status=&weekStart=&weekEnd=&orderSource=&limit=
 * Query local square_transactions table. Defaults to walk_in_sale orders only.
 */
export const GET = withAuth(async (req: NextRequest) => {
  try {
    if (!isAllowedAdminOrigin(req)) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('q')?.trim() || undefined;
    const status = searchParams.get('status')?.trim() || undefined;
    const weekStart = searchParams.get('weekStart')?.trim() || undefined;
    const weekEnd = searchParams.get('weekEnd')?.trim() || undefined;
    // Show all orders by default (sales + repair). Pass orderSource=walk_in_sale to filter.
    const orderSourceRaw = searchParams.get('orderSource')?.trim() || '';
    const orderSource = orderSourceRaw && orderSourceRaw !== 'all' ? orderSourceRaw : undefined;
    const limitRaw = Number(searchParams.get('limit') || 200);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 200;

    const rows = await getSquareTransactions({ search, status, weekStart, weekEnd, orderSource, limit });

    return NextResponse.json({ rows });
  } catch (error: unknown) {
    console.error('GET /api/walk-in/sales error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}, { permission: 'walk_in.view' });

/**
 * DELETE /api/walk-in/sales?id=<uuid> — soft-delete (hide) a walk-in sale.
 *
 * Square is the system of record, so this only hides the local mirror row
 * (sets deleted_at); the sale is NOT removed from Square and re-syncs keep it
 * hidden. Refund/void in Square if you need to reverse the actual sale.
 */
export const DELETE = withAuth(async (req: NextRequest) => {
  try {
    if (!isAllowedAdminOrigin(req)) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }
    const id = new URL(req.url).searchParams.get('id')?.trim();
    if (!id) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
    }

    const hidden = await softDeleteSquareTransaction(id);
    if (!hidden) {
      return NextResponse.json(
        { success: false, error: 'Sale not found or already removed' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, id });
  } catch (error: unknown) {
    console.error('DELETE /api/walk-in/sales error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}, { permission: 'walk_in.intake' });
