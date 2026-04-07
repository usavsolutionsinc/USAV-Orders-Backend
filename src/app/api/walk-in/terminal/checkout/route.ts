import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSquareConfig, squareFetch, formatSquareErrors } from '@/lib/square/client';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';

interface CreateCheckoutBody {
  order_id: string;
  device_id?: string;
  amount_money?: { amount: number; currency: string };
}

/**
 * POST /api/walk-in/terminal/checkout
 * Send a checkout request to a Square Terminal device.
 */
export async function POST(req: NextRequest) {
  try {
    if (!isAllowedAdminOrigin(req)) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as CreateCheckoutBody;

    if (!body.order_id && !body.amount_money) {
      return NextResponse.json(
        { error: 'order_id or amount_money is required' },
        { status: 400 },
      );
    }

    const cfg = getSquareConfig();
    const deviceId =
      body.device_id ||
      process.env.SQUARE_TERMINAL_DEVICE_ID?.trim() ||
      process.env.SQUARE_DEVICE_ID?.trim() ||
      '';

    if (!deviceId) {
      return NextResponse.json(
        { error: 'No terminal device_id provided. Set SQUARE_TERMINAL_DEVICE_ID or SQUARE_DEVICE_ID in env.' },
        { status: 400 },
      );
    }

    const checkoutBody: Record<string, unknown> = {
      idempotency_key: randomUUID(),
      checkout: {
        device_options: {
          device_id: deviceId,
          skip_receipt_screen: false,
          collect_signature: true,
        },
        ...(body.order_id ? { order_id: body.order_id } : {}),
        ...(body.amount_money
          ? { amount_money: body.amount_money }
          : {}),
        payment_type: 'CARD_PRESENT',
      },
    };

    const result = await squareFetch<{ checkout?: Record<string, unknown> }>(
      '/terminals/checkouts',
      { method: 'POST', body: checkoutBody, config: cfg },
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: formatSquareErrors(result.errors) },
        { status: 502 },
      );
    }

    return NextResponse.json({ checkout: result.data.checkout });
  } catch (error: unknown) {
    console.error('POST /api/walk-in/terminal/checkout error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
