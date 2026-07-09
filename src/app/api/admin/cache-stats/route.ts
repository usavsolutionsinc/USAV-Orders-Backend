import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getCacheMetricsSnapshot } from '@/lib/cache/cache-metrics';
import { isRedisCacheEnabled } from '@/lib/cache/cache-flags';
import { isRedisConfigured } from '@/lib/redis/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Per-namespace cache hit/miss/error + rebuild-latency counters (Phase 0.6).
 * Per-instance sampler under Fluid Compute — read as a signal to tune TTLs and
 * prove Neon savings, not a fleet-wide total.
 */
export const GET = withAuth(async () => {
  return NextResponse.json({
    redisConfigured: isRedisConfigured(),
    cacheEnabled: isRedisCacheEnabled(),
    namespaces: getCacheMetricsSnapshot(),
  });
}, { permission: 'admin.view' });
