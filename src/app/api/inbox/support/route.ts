/**
 * GET /api/inbox/support — Zendesk tickets assigned to the logged-in staffer for
 * in-app follow-up (support_ticket_assignments). Own-data read; no special
 * permission (mirrors /api/inbox/tech-queue).
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { listSupportFollowupsForStaff } from '@/lib/inbox/support-followups-queries';

export const runtime = 'nodejs';

export const GET = withAuth(async (_req, ctx) => {
  const items = await listSupportFollowupsForStaff(ctx.organizationId, ctx.staffId);
  return NextResponse.json({ items, count: items.length });
});
