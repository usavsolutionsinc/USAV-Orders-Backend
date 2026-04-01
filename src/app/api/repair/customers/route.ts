import { NextRequest, NextResponse } from 'next/server';
import { searchRepairCustomers } from '@/lib/neon/customer-queries';

/**
 * GET /api/repair/customers?q=<query>&limit=<n>
 * Repair-intake customer lookup for selecting existing customers.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = String(searchParams.get('q') || '').trim();
    const limitRaw = Number(searchParams.get('limit') || 20);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 20;

    const customers = await searchRepairCustomers(q, limit);
    return NextResponse.json({ customers });
  } catch (error: any) {
    console.error('GET /api/repair/customers error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch customers', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}
