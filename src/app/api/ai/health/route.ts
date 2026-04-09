import { NextResponse } from 'next/server';
import { formatPSTTimestamp } from '@/utils/date';

export const runtime = 'nodejs';

const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || '';
const OPENCLAW_USAV_TOKEN = process.env.OPENCLAW_USAV_TOKEN || '';

export async function GET() {
  const timestamp = formatPSTTimestamp();

  if (!OPENCLAW_GATEWAY_URL) {
    return NextResponse.json(
      { ok: false, error: 'OPENCLAW_GATEWAY_URL not configured', timestamp },
      { status: 503 },
    );
  }

  try {
    const res = await fetch(`${OPENCLAW_GATEWAY_URL}/v1/models`, {
      headers: { Authorization: `Bearer ${OPENCLAW_USAV_TOKEN}` },
      signal: AbortSignal.timeout(8_000),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const models = data?.data ?? [];
      return NextResponse.json({
        ok: true,
        backend: 'openclaw',
        model: models[0]?.id ?? 'openclaw/usav-ops',
        timestamp,
      });
    }

    return NextResponse.json(
      { ok: false, error: `Gateway returned ${res.status}`, timestamp },
      { status: 503 },
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'OpenClaw unreachable', timestamp },
      { status: 503 },
    );
  }
}
