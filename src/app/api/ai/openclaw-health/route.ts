/**
 * @deprecated The `openclaw-` name is retained only for URL compatibility.
 * Health now pings the local Hermes gateway on 127.0.0.1:8642.
 */
import { NextResponse } from 'next/server';
import { formatPSTTimestamp } from '@/utils/date';

export const runtime = 'nodejs';

const HERMES_API_URL = process.env.HERMES_API_URL || 'http://127.0.0.1:8642/v1';

export async function GET() {
  const timestamp = formatPSTTimestamp();

  try {
    const res = await fetch(`${HERMES_API_URL}/models`, {
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
}
