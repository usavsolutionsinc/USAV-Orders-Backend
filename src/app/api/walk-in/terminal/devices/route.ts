import { NextRequest, NextResponse } from 'next/server';
import { squareFetch, formatSquareErrors } from '@/lib/square/client';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';

/**
 * GET /api/walk-in/terminal/devices
 * List paired Square Terminal devices.
 */
export async function GET(req: NextRequest) {
  try {
    if (!isAllowedAdminOrigin(req)) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }

    const result = await squareFetch<{ devices?: Array<Record<string, unknown>> }>(
      '/devices',
      { method: 'GET' },
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: formatSquareErrors(result.errors) },
        { status: 502 },
      );
    }

    // Filter to terminal devices only
    const devices = (result.data.devices || []).filter(
      (d: any) => d.product_type === 'TERMINAL_API' || d.components?.some?.((c: any) => c.type === 'APPLICATION' && c.application_details?.application_type === 'TERMINAL_API'),
    );

    return NextResponse.json({ devices });
  } catch (error: unknown) {
    console.error('GET /api/walk-in/terminal/devices error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
