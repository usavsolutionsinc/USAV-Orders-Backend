import { NextRequest, NextResponse } from 'next/server';
import { getSquareTransactions } from '@/lib/neon/square-transaction-queries';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';

/**
 * GET /api/walk-in/sales?q=&status=&weekStart=&weekEnd=&orderSource=&limit=
 * Query local square_transactions table. Defaults to walk_in_sale orders only.
 */
export async function GET(req: NextRequest) {
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
}
