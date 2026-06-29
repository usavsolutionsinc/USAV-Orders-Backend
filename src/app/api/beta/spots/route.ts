/**
 * GET /api/beta/spots
 *
 * PUBLIC, data-driven "spots remaining" counter for the marketing site.
 * total  = BETA_MAX_SPOTS env (default 20)
 * taken  = beta_waitlist rows whose status is 'invited' or 'converted'
 * available = max(0, total - taken)
 *
 * Cross-origin: answers CORS preflight (OPTIONS) and stamps CORS headers on
 * the GET response. Allowed origin = MARKETING_ORIGIN (default
 * https://cycleforge.com) + http://localhost:3001 in dev.
 *
 * Response: { total, taken, available }
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// ── CORS ────────────────────────────────────────────────────────────────────
function allowedOrigins(): string[] {
  const marketing = process.env.MARKETING_ORIGIN || 'https://cycleforge.com';
  const origins = [marketing];
  if (process.env.NODE_ENV !== 'production') origins.push('http://localhost:3001');
  return origins;
}

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin');
  const allowed = allowedOrigins();
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0]!;
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: NextRequest) {
  const cors = corsHeaders(req);
  const total = Number(process.env.BETA_MAX_SPOTS || 20);

  let taken = 0;
  try {
    const res = await pool.query<{ taken: string }>(
      `SELECT COUNT(*)::text AS taken
         FROM beta_waitlist
        WHERE status IN ('invited', 'converted')`,
    );
    taken = Number(res.rows[0]?.taken ?? 0);
  } catch (err) {
    // Degrade gracefully — a counter failure shouldn't break the landing page.
    console.error('[beta-spots] db error:', err);
  }

  const available = Math.max(0, total - taken);
  return NextResponse.json({ total, taken, available }, { headers: cors });
}
