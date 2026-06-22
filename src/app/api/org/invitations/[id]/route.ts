/**
 * DELETE /api/org/invitations/[id] — revoke a pending invitation.
 *
 * Gated by admin.manage_staff, scoped to the caller's org. Mirrors the
 * idFromUrl pattern used by other [id] admin routes (withAuth does not forward
 * Next's route params).
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { revokeInvitation } from '@/lib/identity/invitations';

function idFromUrl(req: Request): string | null {
  const segs = new URL(req.url).pathname.split('/').filter(Boolean);
  // .../api/org/invitations/<id>
  const last = segs[segs.length - 1];
  return last && last !== 'invitations' ? decodeURIComponent(last) : null;
}

export const DELETE = withAuth(async (req, ctx) => {
  const id = idFromUrl(req);
  if (!id) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });

  const removed = await revokeInvitation(ctx.organizationId, id);
  if (!removed) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ ok: true });
}, {
  permission: 'admin.manage_staff',
  audit: {
    source: 'admin',
    action: 'org.invitation.revoke',
    entityType: 'org_invitation',
    entityId: ({ req }) => {
      const segs = new URL(req.url).pathname.split('/').filter(Boolean);
      return segs[segs.length - 1] ?? null;
    },
  },
});
