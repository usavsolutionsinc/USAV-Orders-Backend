import { NextResponse } from 'next/server';
import { formatPSTTimestamp } from '@/utils/date';
import { withAuth } from '@/lib/auth/withAuth';
import { getHermesApiUrl, getHermesHeaders } from '@/lib/ai/hermes-client';

export const runtime = 'nodejs';

// Simple liveness probe. Prefer /api/ai/chat-health for the richer shape
// used by AiChatPanel.tsx; this route stays for any legacy consumers.

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
}, { permission: 'dashboard.view' });
