/**
 * GET /api/beta/applications?status=RECEIVED&limit=100
 *
 * Minimal admin review queue for the $50 beta application pipeline
 * (docs/todo/beta-intake-funnel-plan.md §6 "Admin read"). No beta_waitlist
 * admin surface exists to extend, so this is API-only — the review UI is
 * deferred (v1 review happens via this endpoint / SQL per the plan).
 *
 * PLATFORM-GLOBAL DATA, deliberately NOT tenant-scoped: beta_applications
 * rows are pre-tenant (no organization_id — see the 2026-07-09e migration
 * header), so there is no org to scope by and no withTenantTransaction.
 * Gated by the dedicated `beta.review` permission (permission-registry.ts),
 * intended for platform-operator roles only — reviewing the funnel is a
 * platform job, not a tenant-admin job.
 *
 * Note: /api/beta/* is in the proxy PUBLIC_PATHS allowlist (edge cookie
 * gate), but withAuth here still enforces a real session + permission —
 * the proxy is only a pre-filter, never the gate.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { isBetaApplicationStatus } from '@/lib/beta/apply-schema';

export const runtime = 'nodejs';

export const GET = withAuth(async (req: NextRequest) => {
  const statusParam = req.nextUrl.searchParams.get('status');
  if (statusParam !== null && !isBetaApplicationStatus(statusParam)) {
    return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 });
  }
  const limitRaw = Number(req.nextUrl.searchParams.get('limit') || 200);
  if (!Number.isFinite(limitRaw)) {
    return NextResponse.json({ error: 'INVALID_LIMIT' }, { status: 400 });
  }
  const limit = Math.min(500, Math.max(1, Math.floor(limitRaw)));

  const params: unknown[] = [limit];
  let where = '';
  if (statusParam) {
    params.push(statusParam);
    where = `WHERE status = $${params.length}`;
  }

  const r = await pool.query(
    `SELECT id, email, company_name, tier, status, answers, stripe_ref,
            created_at, updated_at
       FROM beta_applications
       ${where}
      ORDER BY created_at DESC
      LIMIT $1`,
    params,
  );

  return NextResponse.json({ applications: r.rows });
}, { permission: 'beta.review' });
