/**
 * POST /api/admin/org/delete
 *
 * Soft-deletes the caller's organization. The actual purge runs out-of-band
 * (cron job, not implemented here) — this endpoint just flips status to
 * 'deleted' and stamps deleted_at. All sessions for the org are revoked
 * immediately so the admin who triggered it gets signed out.
 *
 * Satisfies GDPR Article 17 / CCPA right to delete. Step-up + admin.view
 * required, plus the request must carry `{ confirm: "<slug>" }` to
 * guarantee intent (matches the Stripe "type the org name" pattern).
 */

import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { getOrganization, setOrgStatus, invalidateOrgCache } from '@/lib/tenancy/organizations';

export const POST = withAuth(async (req, ctx) => {
  const org = await getOrganization(ctx.organizationId);
  if (!org) return NextResponse.json({ error: 'ORG_NOT_FOUND' }, { status: 404 });
  if (org.status === 'deleted') {
    return NextResponse.json({ error: 'ALREADY_DELETED' }, { status: 410 });
  }

  let body: { confirm?: string } = {};
  try { body = await req.json(); } catch { /* tolerate empty body */ }
  if (!body.confirm || body.confirm !== org.slug) {
    return NextResponse.json(
      { error: 'CONFIRMATION_REQUIRED', expected: org.slug },
      { status: 400 },
    );
  }

  await pool.query(
    `UPDATE organizations SET status = 'deleted', deleted_at = now(), updated_at = now() WHERE id = $1`,
    [org.id],
  );
  await setOrgStatus(org.id, 'deleted');
  invalidateOrgCache(org.id);

  // Revoke every active session for this org so the user is signed out
  // immediately and no parallel tab keeps acting under the deleted tenant.
  await pool.query(
    `UPDATE staff_sessions SET revoked_at = now()
      WHERE organization_id = $1 AND revoked_at IS NULL`,
    [org.id],
  );

  return NextResponse.json({
    status: 'deleted',
    purgeScheduledFor: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    message: 'Data will be purged 30 days from now. Contact support to restore before then.',
  });
}, {
  permission: 'admin.view',
  stepUp: true,
  audit: {
    source: 'admin',
    action: 'org.delete',
    entityType: 'organization',
    entityId: ({ req }) => req.headers.get('x-request-id') || 'delete',
  },
});
