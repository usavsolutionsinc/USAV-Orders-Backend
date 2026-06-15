import { NextRequest, NextResponse } from 'next/server';
import { searchRepairCustomers } from '@/lib/neon/customer-queries';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * GET /api/repair/customers?q=<query>&limit=<n>
 * Repair-intake customer lookup for selecting existing customers.
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(req.url);
    const q = String(searchParams.get('q') || '').trim();
    const limitRaw = Number(searchParams.get('limit') || 20);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 20;

    // Tenant isolation: scope the customer lookup to the caller's org. Without
    // this, a blank `q` enumerates the most-recently-updated customers across
    // ALL organizations and any `q` searches every org's customer PII.
    const customers = await searchRepairCustomers(q, limit, ctx.organizationId);
    return NextResponse.json({ customers });
  } catch (error: any) {
    console.error('GET /api/repair/customers error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch customers', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}, { permission: 'repair.view' });
