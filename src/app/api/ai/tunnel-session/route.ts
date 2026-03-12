import { NextResponse } from 'next/server';
import { getTunnelUrl } from '@/lib/ai/tunnel-config';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const tunnelUrl = await getTunnelUrl();
    const apiKey = process.env.AI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: 'AI_API_KEY not configured on server' }, { status: 500 });
    }

    const upstream = await fetch(`${tunnelUrl}/chat/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      return NextResponse.json(
        { error: data?.error ?? 'Chatbot backend error' },
        { status: upstream.status }
      );
    }

    return NextResponse.json(data);
  } catch (err: any) {
    console.error('[tunnel-session] Error:', err?.message);
    return NextResponse.json(
      { error: err?.message ?? 'Failed to create chat session' },
      { status: 503 }
    );
  }
}
