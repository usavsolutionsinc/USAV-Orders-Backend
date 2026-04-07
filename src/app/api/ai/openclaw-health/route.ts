import { NextResponse } from 'next/server';
import { formatPSTTimestamp } from '@/utils/date';

export const runtime = 'nodejs';

const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || '';
const OPENCLAW_USAV_TOKEN = process.env.OPENCLAW_USAV_TOKEN || '';
const MAC_LM_STUDIO_URL = process.env.MAC_LM_STUDIO_URL || 'http://100.64.38.223:8080';

/**
 * Health check for AI backends: Mac LM Studio → OpenClaw → Ollama.
 */
export async function GET() {
  const timestamp = formatPSTTimestamp();

  // 1. Try Mac LM Studio (Qwen3-32B)
  try {
    const res = await fetch(`${MAC_LM_STUDIO_URL}/v1/models`, {
      headers: { Authorization: 'Bearer lm-studio' },
      signal: AbortSignal.timeout(5_000),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const models = data?.data ?? [];
      return NextResponse.json({
        ok: true,
        backend: 'mac-lm-studio',
        model: models.find((m: { id?: string }) => m.id?.includes('32b'))?.id ?? models[0]?.id ?? 'unknown',
        timestamp,
      });
    }
  } catch {
    // Fall through
  }

  // 2. Try OpenClaw gateway
  if (OPENCLAW_GATEWAY_URL && OPENCLAW_USAV_TOKEN) {
    try {
      const res = await fetch(`${OPENCLAW_GATEWAY_URL}/v1/models`, {
        headers: { Authorization: `Bearer ${OPENCLAW_USAV_TOKEN}` },
        signal: AbortSignal.timeout(5_000),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const models = data?.data ?? [];
        return NextResponse.json({
          ok: true,
          backend: 'openclaw',
          model: models[0]?.id ?? 'qwen3:8b',
          timestamp,
        });
      }
    } catch {
      // Fall through
    }
  }

  // 3. Fallback: Ollama direct
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const model = data?.models?.[0]?.name ?? process.env.OLLAMA_MODEL ?? 'unknown';
      return NextResponse.json({
        ok: true,
        backend: 'ollama',
        model,
        timestamp,
      });
    }
  } catch {
    // All unavailable
  }

  return NextResponse.json(
    { ok: false, backend: null, error: 'No AI backend reachable', timestamp },
    { status: 503 },
  );
}
