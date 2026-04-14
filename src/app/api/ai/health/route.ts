import { NextResponse } from 'next/server';
import { formatPSTTimestamp } from '@/utils/date';

export const runtime = 'nodejs';

// Simple liveness probe. Prefer /api/ai/openclaw-health for the richer shape
// used by AiChatPanel.tsx; this route stays for any legacy consumers.
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
        timestamp,
      });
    }

    return NextResponse.json(
      { ok: false, error: `Hermes returned ${res.status}`, timestamp },
      { status: 503 },
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Hermes unreachable', timestamp },
      { status: 503 },
    );
  }
}
