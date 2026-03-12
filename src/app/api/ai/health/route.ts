import { NextResponse } from 'next/server';
import { pingOllama } from '@/lib/ai/ollama';
import { formatPSTTimestamp } from '@/utils/date';

export const runtime = 'nodejs';

export async function GET() {
  const ollama = await pingOllama();

  return NextResponse.json(
    {
      ok: ollama.ok,
      ollama,
      tunnelUrl: process.env.OLLAMA_TUNNEL_URL || null,
      baseUrl: process.env.OLLAMA_BASE_URL || null,
      model: process.env.OLLAMA_MODEL || null,
      timestamp: formatPSTTimestamp(),
    },
    { status: ollama.ok ? 200 : 503 }
  );
}
