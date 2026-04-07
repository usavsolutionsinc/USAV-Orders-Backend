import { NextRequest, NextResponse } from 'next/server';
import { squareFetch, formatSquareErrors } from '@/lib/square/client';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';

interface SquareCustomer {
  id: string;
  given_name?: string;
  family_name?: string;
  phone_number?: string;
  email_address?: string;
  created_at?: string;
}

/**
 * GET /api/walk-in/customers?q=
 * List last 50 Square customers. If q provided, filters client-side by name/phone/email.
 */
export async function GET(req: NextRequest) {
  try {
    if (!isAllowedAdminOrigin(req)) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }

    const query = new URL(req.url).searchParams.get('q')?.trim().toLowerCase() || '';

    // Fetch last 50 customers sorted by most recent
    const result = await squareFetch<{ customers?: SquareCustomer[] }>(
      '/customers/search',
      {
        method: 'POST',
        body: {
          limit: 50,
          query: {
            sort: { field: 'CREATED_AT', order: 'DESC' },
          },
        },
      },
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: formatSquareErrors(result.errors) },
        { status: 502 },
      );
    }

    let customers = result.data.customers || [];

    // Client-side filter if query provided
    if (query) {
      customers = customers.filter((c) => {
        const name = `${c.given_name || ''} ${c.family_name || ''}`.toLowerCase();
        const phone = (c.phone_number || '').replace(/\D/g, '');
        const email = (c.email_address || '').toLowerCase();
        const q = query.replace(/\D/g, '');
        return (
          name.includes(query) ||
          email.includes(query) ||
          (q.length >= 3 && phone.includes(q))
        );
      });
    }

    return NextResponse.json({ customers });
  } catch (error: unknown) {
    console.error('GET /api/walk-in/customers error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/walk-in/customers
 * Create a new Square customer.
 */
export async function POST(req: NextRequest) {
  try {
    if (!isAllowedAdminOrigin(req)) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      given_name?: string;
      family_name?: string;
      phone_number?: string;
      email_address?: string;
    };

    if (!body.given_name && !body.phone_number) {
      return NextResponse.json(
        { error: 'At least given_name or phone_number is required' },
        { status: 400 },
      );
    }

    const result = await squareFetch<{ customer?: SquareCustomer }>(
      '/customers',
      { method: 'POST', body },
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: formatSquareErrors(result.errors) },
        { status: 502 },
      );
    }

    return NextResponse.json({ customer: result.data.customer });
  } catch (error: unknown) {
    console.error('POST /api/walk-in/customers error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
