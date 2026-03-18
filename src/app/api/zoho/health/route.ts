import { NextResponse } from 'next/server';
import { getZohoHttpClientStatus } from '@/lib/zoho/httpClient';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = getZohoHttpClientStatus();
    return NextResponse.json({
      success: true,
      zoho: {
        requests_per_minute_budget: status.config.reservoir,
        configured_headroom: '80/100 req per minute',
        max_concurrent: status.config.maxConcurrent,
        min_spacing_ms: status.config.minTimeMs,
        max_retries: status.config.maxRetries,
        circuit: status.circuit,
        limiter: status.limiter,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load Zoho health status';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
