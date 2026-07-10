import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getOnboardingStats } from '@/lib/onboarding/stats';

/**
 * GET /api/onboarding/stats — org-scoped activation counts for the
 * Getting-Started checklist (onboarding-foundational-plan §8, O1).
 *
 * Read-only Monitor-style aggregate: cheap capped COUNTs under the standard
 * tenant path (withTenantTransaction inside the domain helper), never
 * cross-tenant. No mutation, no audit. Gated by `dashboard.view` — the same
 * read permission its dashboard siblings use. Degrade-not-fail: the helper
 * resolves to all-zero stats on error, so this never 500s the dashboard.
 */
export const GET = withAuth(async (_request: NextRequest, ctx) => {
  const stats = await getOnboardingStats(ctx.organizationId);
  return NextResponse.json({ success: true, stats });
}, { permission: 'dashboard.view' });
