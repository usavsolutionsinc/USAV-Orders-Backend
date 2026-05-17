/**
 * Server-only helper for page.tsx / layout.tsx files.
 *
 *   const user = await requirePermission('receiving.view');
 *   // user.staffId, user.role, user.permissions
 *
 * If the user is unauthenticated → redirect to /signin?next=…
 * If the user is authenticated but lacks the permission → /not-authorized
 *
 * While AUTH_V2_ENABLED is off, the guard is permissive: it returns null
 * permissions for unauthenticated callers without redirecting, so existing
 * pages keep rendering during rollout. Pages opt in to enforcement by
 * passing `{ enforce: true }`.
 */

import 'server-only';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getCurrentUser, type CurrentUser } from './current-user';
import type { PermissionString } from './permissions';
import { audit } from './audit';

function isAuthV2Enabled(): boolean {
  return process.env.AUTH_V2_ENABLED === 'true' || process.env.AUTH_V2_ENABLED === '1';
}

export interface PageGuardOpts {
  /** Force enforcement regardless of AUTH_V2_ENABLED. */
  enforce?: boolean;
}

/**
 * Returns the current user if they have the permission, otherwise redirects.
 *
 * When called from a page during the rollout (AUTH_V2_ENABLED=false), an
 * unauthenticated call returns a "stub" CurrentUser so pages don't crash.
 * The stub has empty permissions, but the caller is expected to fall back
 * to the legacy `?staffId=…` flow until cut-over.
 */
export async function requirePermission(
  perm: PermissionString,
  opts: PageGuardOpts = {},
): Promise<CurrentUser | null> {
  const user = await getCurrentUser();
  const enforce = opts.enforce ?? isAuthV2Enabled();

  if (!user) {
    if (!enforce) return null;
    const h = await headers();
    const path = h.get('x-pathname') || '/';
    redirect(`/signin?next=${encodeURIComponent(path)}`);
  }

  if (user && !user.permissions.has(perm)) {
    if (!enforce) return user;
    await audit({
      staffId: user.staffId,
      event: 'permission.denied',
      result: 'denied',
      sid: user.session.sid,
      detail: { permission: perm, page: true },
    });
    redirect('/not-authorized');
  }

  return user;
}
