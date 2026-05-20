/**
 * Readiness endpoint — 200 only when the app can actually serve traffic.
 *
 * Probes the DB pool (cheap `SELECT 1`) and the Redis cache (PING) in
 * parallel; degrades gracefully when Redis is optional. Failing checks
 * return 503 with the failed names listed so the status page can show
 * "DB OK, Redis FAIL" rather than a binary up/down.
 *
 * Public (allowlisted in proxy.ts). Never returns sensitive info.
 */

import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface CheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

async function checkDb(): Promise<CheckResult> {
  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkRedis(): Promise<CheckResult | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // Optional dependency.

  const start = Date.now();
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/ping`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${res.status}` };
    }
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(): Promise<NextResponse> {
  const [db, redis] = await Promise.all([checkDb(), checkRedis()]);

  const checks: Record<string, CheckResult> = { db };
  if (redis) checks.redis = redis;

  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    {
      status: allOk ? 'ready' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    },
    {
      status: allOk ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
