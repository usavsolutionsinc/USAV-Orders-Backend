/**
 * AI Chat health probe — pings the local Hermes gateway on 127.0.0.1:8642
 * (reached from Vercel via Cloudflare tunnel) and reports the live model list.
 */
import { NextResponse } from 'next/server';
import { formatPSTTimestamp } from '@/utils/date';
import { withAuth } from '@/lib/auth/withAuth';
import { getHermesApiUrl, getHermesHeaders } from '@/lib/ai/hermes-client';

export const runtime = 'nodejs';

export const GET = withAuth(async () => {
  const timestamp = formatPSTTimestamp();

  try {
    const res = await fetch(`${getHermesApiUrl()}/models`, {
      headers: getHermesHeaders(),
      signal: AbortSignal.timeout(4_000),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const models = data?.data ?? [];
      return NextResponse.json({
        ok: true,
        backend: 'hermes-local',
        model: models[0]?.id ?? 'hermes-agent',
        models: models.map((m: { id?: string }) => m.id),
        timestamp,
      });
    }

    return NextResponse.json(
      { ok: false, backend: 'hermes-local', error: `Hermes returned ${res.status}`, timestamp },
      { status: 503 },
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        backend: 'hermes-local',
        error: err?.message ?? 'Hermes gateway unreachable — is the hermes-gateway PM2 app running?',
        timestamp,
      },
      { status: 503 },
    );
  }
}, { permission: 'dashboard.view' });
