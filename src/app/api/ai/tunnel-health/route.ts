import { NextResponse } from 'next/server';
import { getTunnelUrl, invalidateTunnelUrlCache } from '@/lib/ai/tunnel-config';
import { formatPSTTimestamp } from '@/utils/date';

export const runtime = 'nodejs';

export async function GET() {
  let tunnelUrl: string | null = null;

  try {
    tunnelUrl = await getTunnelUrl();
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, tunnel_url: null, error: err?.message, timestamp: formatPSTTimestamp() },
      { status: 503 }
    );
  }

  try {
    const apiKey = process.env.AI_API_KEY ?? '';
    const upstream = await fetch(`${tunnelUrl}/config/health`, {
      headers: { 'x-api-key': apiKey },
      // Short timeout — this is a liveness ping
      signal: AbortSignal.timeout(5000),
    });

    return NextResponse.json({
      ok: upstream.ok,
      tunnel_url: tunnelUrl,
      timestamp: formatPSTTimestamp(),
    });
  } catch {
    // If the tunnel is unreachable, invalidate the cache so the next request
    // re-reads the DB in case the URL has been updated.
    invalidateTunnelUrlCache();

    return NextResponse.json(
      { ok: false, tunnel_url: tunnelUrl, error: 'Tunnel unreachable', timestamp: formatPSTTimestamp() },
      { status: 503 }
    );
  }
}
